import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import dotenv from 'dotenv';
import {
  isPrivilegedSupabaseKey,
  RPC_AUTH_UNAVAILABLE_MESSAGE,
  RPC_HARDENING_MISSING_MESSAGE,
} from './rpcAuthorization.ts';
import {
  User,
  Product,
  Customer,
  Dispatch,
  Delivery,
  LoadedItem,
  EndOfDayReconciliation,
  ProductCategoryInfo,
  CleanupStatus,
  DatabaseStatus,
  RetentionHealth,
  RetentionRunResult,
} from '../types/index.ts';
import {
  utcDayQueryWindow,
  isSameUtcDate,
  RETENTION_DAYS,
  retentionCutoffDate,
  retentionCutoffInstant,
} from '../services/dateWindow.ts';
import { applyRetentionToLocal } from '../services/retentionRules.ts';

const { Pool } = pg;

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.resolve(__dirname, '../../data_store.json');

// ----------------------------------------------------------------------
// CANONICAL REFERENCE DATA (depozito türleri & ürün kategorileri)
// Veritabanındaki deposit_types / product_categories tablolarıyla birebir eşleşir.
// Yalnızca referans verisidir; kullanıcı veya müşteri kaydı içermez.
// ----------------------------------------------------------------------
const DEPOSIT_TYPES_REF: Array<{ code: string; label_tr: string; is_returnable: boolean; sort_order: number }> = [
  { code: 'damacana', label_tr: 'Damacana (Plastik/Polikarbon)', is_returnable: true, sort_order: 1 },
  { code: 'cam_damacana', label_tr: 'Cam Damacana', is_returnable: true, sort_order: 2 },
  { code: 'tup', label_tr: 'Gaz Tüpü', is_returnable: true, sort_order: 3 },
  { code: 'none', label_tr: 'Yok', is_returnable: false, sort_order: 99 },
];

const PRODUCT_CATEGORIES_REF: Array<{
  code: string;
  title_tr: string;
  sort_order: number;
  default_unit: string;
  default_is_deposit: boolean;
  default_deposit_type: string;
}> = [
  { code: 'damacana', title_tr: 'Damacana Su', sort_order: 1, default_unit: 'Adet', default_is_deposit: true, default_deposit_type: 'damacana' },
  { code: 'pet', title_tr: 'Pet Su', sort_order: 2, default_unit: 'Koli', default_is_deposit: false, default_deposit_type: 'none' },
  { code: 'tup', title_tr: 'Tüp', sort_order: 3, default_unit: 'Adet', default_is_deposit: true, default_deposit_type: 'tup' },
  { code: 'soda', title_tr: 'Maden Suyu / İçecek', sort_order: 4, default_unit: 'Koli', default_is_deposit: false, default_deposit_type: 'none' },
  { code: 'bardak', title_tr: 'Bardak & Sarf Malzeme', sort_order: 5, default_unit: 'Paket', default_is_deposit: false, default_deposit_type: 'none' },
];

const DEPOSIT_BUCKETS: Array<{ depositType: string; key: 'damacana' | 'camDamacana' | 'tup' }> = [
  { depositType: 'damacana', key: 'damacana' },
  { depositType: 'cam_damacana', key: 'camDamacana' },
  { depositType: 'tup', key: 'tup' },
];

// ----------------------------------------------------------------------
// ENVIRONMENT & CREDENTIAL RESOLUTION & CONFIG MANAGEMENT
// ----------------------------------------------------------------------
const CONFIG_FILE = path.resolve(__dirname, '../../supabase_config.json');

export interface SupabaseCustomConfig {
  url?: string;
  key?: string;
  enabled?: boolean;
  note?: string;
}

export function loadSupabaseConfig(): SupabaseCustomConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(data) as SupabaseCustomConfig;
    }
  } catch (err) {
    console.error('Error reading supabase_config.json', err);
  }
  return {};
}

export function saveSupabaseConfig(cfg: SupabaseCustomConfig): void {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing supabase_config.json', err);
  }
}

let activeConfig = loadSupabaseConfig();

const isPlaceholderUrl = (url: string) => {
  if (!url) return true;
  const lower = url.toLowerCase();
  return (
    lower.includes('xyzcompany') ||
    lower.includes('ckidigqrofzquhmejzwf') ||
    lower.includes('yourproject') ||
    lower.includes('example') ||
    lower.includes('placeholder')
  );
};

let envSupabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  '';

if (isPlaceholderUrl(envSupabaseUrl) && !activeConfig.url) {
  envSupabaseUrl = '';
}

let rawSupabaseUrl = activeConfig.url || envSupabaseUrl;

let rawSupabaseKey =
  activeConfig.key ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  '';

if (isPlaceholderUrl(rawSupabaseUrl)) {
  rawSupabaseKey = '';
}

const rawDatabaseUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.SUPABASE_DB_URL ||
  '';

export let isSupabaseApiConfigured = Boolean(
  rawSupabaseUrl &&
  rawSupabaseKey &&
  rawSupabaseUrl.startsWith('http') &&
  !isPlaceholderUrl(rawSupabaseUrl)
);

export const isPostgresDirectConfigured = Boolean(
  rawDatabaseUrl &&
  (rawDatabaseUrl.startsWith('postgres://') || rawDatabaseUrl.startsWith('postgresql://')) &&
  !rawDatabaseUrl.includes('dummy')
);

export let supabase: SupabaseClient | null = isSupabaseApiConfigured
  ? createClient(rawSupabaseUrl, rawSupabaseKey, {
      auth: { persistSession: false },
    })
  : null;

export function isSupabaseOperational(): boolean {
  return Boolean(isSupabaseApiConfigured && supabase);
}

export async function configureSupabase(cfg: { url?: string; key?: string; enabled?: boolean }) {
  if (cfg.enabled === false) {
    const update = { enabled: false, note: 'Kullanıcı yerel depolama modunu seçti.' };
    saveSupabaseConfig(update);
    activeConfig = update;
    isSupabaseApiConfigured = false;
    supabase = null;
    return {
      success: true,
      message: 'Supabase bulut bağlantısı devre dışı bırakıldı. Sistem yerel veritabanı (data_store.json) modunda çalışıyor.',
    };
  }

  const newUrl = cfg.url?.trim() || '';
  const newKey = cfg.key?.trim() || '';

  if (!newUrl || !newKey) {
    throw new Error('Supabase URL ve Anon Key zorunludur.');
  }

  if (!newUrl.startsWith('https://') && !newUrl.startsWith('http://')) {
    throw new Error('Geçerli bir Supabase URL giriniz (örn: https://xyzcompany.supabase.co)');
  }

  // Probe new URL before saving
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const probeUrl = `${newUrl.replace(/\/$/, '')}/rest/v1/?apikey=${newKey}`;
    const res = await fetch(probeUrl, {
      method: 'GET',
      headers: {
        apikey: newKey,
        Authorization: `Bearer ${newKey}`,
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (res.status >= 500) {
      throw new Error(`Supabase sunucusu ${res.status} hatası döndürdü.`);
    }
  } catch (err: any) {
    if (err?.code === 'ENOTFOUND' || err?.message?.includes('ENOTFOUND')) {
      throw new Error(`DNS Hatası: "${newUrl}" adresi bulunamadı. Lütfen URL'yi kontrol edin.`);
    }
    throw new Error(`Supabase bağlantı testi başarısız: ${err?.message || err}`);
  }

  saveSupabaseConfig({ url: newUrl, key: newKey, enabled: true });
  activeConfig = { url: newUrl, key: newKey, enabled: true };
  rawSupabaseUrl = newUrl;
  rawSupabaseKey = newKey;
  isSupabaseApiConfigured = true;
  supabase = createClient(newUrl, newKey, { auth: { persistSession: false } });

  // Auto-seed if needed
  await ensureSupabaseSeeded();

  return {
    success: true,
    message: 'Yeni Supabase veritabanına başarıyla bağlanıldı ve tablolar hazırlandı!',
  };
}

let pgPool: pg.Pool | null = null;
if (isPostgresDirectConfigured) {
  try {
    pgPool = new Pool({
      connectionString: rawDatabaseUrl,
      ssl: rawDatabaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    });
  } catch (e) {
    console.error('[Postgres Pool Error]', e);
  }
}

if (isSupabaseApiConfigured) {
  console.log(`[Database] Supabase API active! Connected to: ${rawSupabaseUrl}`);
} else if (isPostgresDirectConfigured) {
  console.log(`[Database] PostgreSQL direct connection active via DATABASE_URL!`);
} else {
  console.log('[Database] Supabase env variables not found or placeholder; using local data_store.json.');
}

// ----------------------------------------------------------------------
// LOCAL JSON FALLBACK DATABASE
// ----------------------------------------------------------------------
interface LocalDatabaseSchema {
  users: User[];
  products: Product[];
  customers: Customer[];
  dispatches: Dispatch[];
  deliveries: Delivery[];
  lastCleanupDate?: string;
  purgedCountTotal?: number;
  reopenAudit?: Array<{
    dispatchId: string;
    reopenedByUserId: string;
    reopenedByUserName: string;
    reason: string;
    previousClosedAt: string | null;
    previousReconciliation: EndOfDayReconciliation | null;
    reopenedAt: string;
  }>;
  loadingAudit?: Array<{
    dispatchId: string;
    changedByUserId: string;
    changedByUserName: string;
    previousItems: LoadedItem[];
    newItems: LoadedItem[];
    changedAt: string;
  }>;
  financialAudit?: Array<{
    customerId: string;
    changedByUserId: string;
    changedByUserName: string;
    reason: string;
    previousBalance: number | null;
    newBalance: number | null;
    previousEmpty: any;
    newEmpty: any;
    changedAt: string;
  }>;
  retentionArchive?: Array<{
    runId: string;
    purgeDate: string;
    retentionDays: number;
    dispatches: Dispatch[];
    deliveries: Delivery[];
  }>;
}

// Kanonik ürün kataloğu. Yerel varsayılan veri ve Supabase referans ekimi
// (ensureSupabaseSeeded) için tek doğruluk kaynağıdır. data_store.json'daki
// eski kayıtlar bu listeyi ASLA değiştirmez / bu listeye yazılmaz.
const CANONICAL_SEED_PRODUCTS: Product[] = [
  {
    id: 'prod_damacana_19l',
    name: 'Hayat Damacana',
    category: 'damacana',
    defaultUnitPrice: 100,
    isDeposit: true,
    depositType: 'damacana',
    unit: 'Adet',
    description: 'Doğal kaynak damacana su - depozitolu 19 litre'
  },
  {
    id: 'prod_cam_damacana',
    name: 'Hayat Cam Damacana',
    category: 'damacana',
    defaultUnitPrice: 250,
    isDeposit: true,
    depositType: 'cam_damacana',
    unit: 'Adet',
    description: 'Hayat cam damacana su - boş cam damacana iadesi zorunlu'
  },
  {
    id: 'prod_damacana_sirma_19l',
    name: 'Sırma Damacana',
    category: 'damacana',
    defaultUnitPrice: 100,
    isDeposit: true,
    depositType: 'damacana',
    unit: 'Adet',
    description: 'Sırma doğal kaynak suyu 19L - depozitolu'
  },
  {
    id: 'prod_tup_12kg',
    name: 'Büyük Tüp (12 Kg - Tombul/Uzun)',
    category: 'tup',
    defaultUnitPrice: 750,
    isDeposit: true,
    depositType: 'tup',
    unit: 'Adet',
    description: 'Ev tipi 12kg gaz tüpü - depozitolu boş tüp iadeli'
  },
  {
    id: 'prod_tup_2kg',
    name: 'Küçük Tüp (2 Kg)',
    category: 'tup',
    defaultUnitPrice: 160,
    isDeposit: true,
    depositType: 'tup',
    unit: 'Adet',
    description: '2kg piknik gaz tüpü - depozitolu'
  },
  {
    id: 'prod_pet_hayat_1_5l_6',
    name: "Hayat 1.5 lt Pet Su (6'lı Koli)",
    category: 'pet',
    defaultUnitPrice: 110,
    isDeposit: false,
    depositType: 'none',
    unit: 'Koli',
    description: '6 adet 1.5 litre pet şişe su'
  },
  {
    id: 'prod_pet_hayat_0_5l_12',
    name: "Hayat 0.5 lt Pet Su (12'li Koli)",
    category: 'pet',
    defaultUnitPrice: 120,
    isDeposit: false,
    depositType: 'none',
    unit: 'Koli',
    description: '12 adet 500 ml pet şişe doğal kaynak suyu'
  },
  {
    id: 'prod_soda_beypazari_24',
    name: "Beypazarı Maden Suyu (24'lü Koli)",
    category: 'soda',
    defaultUnitPrice: 180,
    isDeposit: false,
    depositType: 'none',
    unit: 'Koli',
    description: 'Doğal maden suyu 200ml cam şişe'
  },
  {
    id: 'prod_soda_kizilay_24',
    name: "Kızılay Maden Suyu (24'lü Koli)",
    category: 'soda',
    defaultUnitPrice: 175,
    isDeposit: false,
    depositType: 'none',
    unit: 'Koli',
    description: '24 adet 200ml sade maden suyu'
  },
  {
    id: 'prod_soda_limonlu_24',
    name: "Limonlu Soda (24'lü Koli)",
    category: 'soda',
    defaultUnitPrice: 100,
    isDeposit: false,
    depositType: 'none',
    unit: 'Koli',
    description: 'Limonlu maden suyu 200ml cam şişe'
  },
  {
    id: 'prod_bardak_karton_6_5oz_3000',
    name: "Karton Bardak 6.5 oz (3000'li Koli)",
    category: 'bardak',
    defaultUnitPrice: 320,
    isDeposit: false,
    depositType: 'none',
    unit: 'Koli',
    description: 'Sıcak ve soğuk su sebili uyumlu tek kullanımlık bardak'
  },
  {
    id: 'prod_bardak_karton_6_5oz_50',
    name: "Karton Bardak 6.5 oz (50'li Paket)",
    category: 'bardak',
    defaultUnitPrice: 35,
    isDeposit: false,
    depositType: 'none',
    unit: 'Paket',
    description: '50 adetlik rulo paket perakende satış'
  },
  {
    id: 'prod_bardak_plastik_3000',
    name: "Plastik Bardak (3000'li Koli)",
    category: 'bardak',
    defaultUnitPrice: 100,
    isDeposit: false,
    depositType: 'none',
    unit: 'Koli',
    description: "Plastik Bardak 200 ml 3000'li Koli"
  },
  {
    id: 'prod_bardak_plastik_50',
    name: "Plastik Bardak (50'li Paket)",
    category: 'bardak',
    defaultUnitPrice: 100,
    isDeposit: false,
    depositType: 'none',
    unit: 'Paket',
    description: 'Tek kullanımlık plastik bardak perakende paket'
  },
  {
    id: 'prod_bardak_su_60',
    name: "Bardak Su (60'lı Koli)",
    category: 'bardak',
    defaultUnitPrice: 90,
    isDeposit: false,
    depositType: 'none',
    unit: 'Koli',
    description: "60'lı koli bardak su"
  },
  {
    id: 'prod_cay_dokme_1kg',
    name: '1 Kg Dökme Çay',
    category: 'bardak',
    defaultUnitPrice: 100,
    isDeposit: false,
    depositType: 'none',
    unit: 'Paket',
    description: 'Dökme çay 1 kg paket'
  }
];

export function loadLocalDatabase(): LocalDatabaseSchema {
  let db: LocalDatabaseSchema | null = null;
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf-8');
      db = JSON.parse(data) as LocalDatabaseSchema;
    }
  } catch (err) {
    console.error('Error loading local database file', err);
  }

  if (db) {
    if (!db.products) db.products = [];
    return db;
  }

  const emptyDb: LocalDatabaseSchema = {
    users: [
      {
        id: 'usr_admin',
        name: 'Uğur Fırtına',
        username: 'yonetici',
        role: 'admin',
        canLoadVehicle: true,
        assignedPlate: '',
        pin: '1234',
        phone: '0532 555 10 00',
        title: 'İş Yeri Sahibi / Depo Yöneticisi',
      },
      {
        id: 'usr_driver_1',
        name: 'Ahmet Yılmaz',
        username: 'ahmet',
        role: 'driver',
        canLoadVehicle: true,
        assignedPlate: '01 FV 823',
        pin: '1010',
        phone: '0533 555 20 01',
        title: 'Tek Yetkili Şoför',
      },
      {
        id: 'usr_driver_2',
        name: 'Mehmet Kaya',
        username: 'mehmet',
        role: 'driver',
        canLoadVehicle: false,
        assignedPlate: '06 GB 357',
        pin: '2020',
        phone: '0535 555 30 02',
        title: 'Saha Dağıtım Şoförü',
      },
      {
        id: 'usr_driver_3',
        name: 'Serkan Aydın',
        username: 'serkan',
        role: 'driver',
        canLoadVehicle: false,
        assignedPlate: '01 AVH 886',
        pin: '3030',
        phone: '0536 555 40 03',
        title: 'Saha Dağıtım Şoförü',
      }
    ],
    products: CANONICAL_SEED_PRODUCTS.map((p) => ({ ...p })),
    customers: [
      {
        id: 'cust_1',
        name: 'Örnek Market Ltd. Şti.',
        phone: '0532 123 45 67',
        address: 'Atatürk Cad. No: 15 Seyhan / Adana',
        emails: ['info@ornekmarket.com', 'fatura@ornekmarket.com'],
        isAccountCustomer: true,
        currentBalanceTL: 450,
        emptyDepositBalance: { damacana: 5, camDamacana: 0, tup: 2 },
        customPrices: { 'prod_damacana_19l': 95 },
        notes: 'Düzenli müşterimiz.',
        createdDate: '2026-01-01',
      }
    ],
    dispatches: [],
    deliveries: [],
    purgedCountTotal: 0,
  };
  saveLocalDatabase(emptyDb);
  return emptyDb;
}

export function saveLocalDatabase(db: LocalDatabaseSchema) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving local database file', err);
  }
}

// ----------------------------------------------------------------------
// DATA MAPPERS (Supabase snake_case <-> TypeScript camelCase)
// ----------------------------------------------------------------------
function mapUserFromDb(row: any): User {
  const isLead = Boolean(row.is_lead_driver || (row.role === 'driver' && row.can_load_vehicle));
  const defaultTitle =
    row.role === 'admin'
      ? 'İş Yeri Sahibi / Depo Yöneticisi'
      : isLead
      ? 'Tek Yetkili Şoför'
      : 'Saha Dağıtım Şoförü';

  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    canLoadVehicle: Boolean(row.can_load_vehicle),
    isLeadDriver: isLead,
    title: row.title || defaultTitle,
    assignedPlate: row.assigned_plate || '',
    pin: row.pin?.toString() || '1234',
    phone: row.phone || '',
  };
}

function mapProductFromDb(row: any): Product {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    defaultUnitPrice: Number(row.default_unit_price) || 100,
    isDeposit: Boolean(row.is_deposit),
    depositType: row.deposit_type || 'none',
    unit: row.unit || 'Adet',
    description: row.description || '',
  };
}

export interface EmptiesCounts {
  damacana: number;
  camDamacana: number;
  tup: number;
}

// Pure helper: attributes delivered quantities to a deposit bucket based solely on the
// product's canonical deposit_type (never on the display name). Unknown product IDs are
// intentionally ignored here so callers can validate them separately.
export function computeDeliveredDeposits(
  items: Array<{ productId: string; quantity: number }>,
  products: Array<{ id: string; depositType: string }>
): EmptiesCounts {
  const result: EmptiesCounts = { damacana: 0, camDamacana: 0, tup: 0 };
  for (const item of items) {
    const prod = products.find((p) => p.id === item.productId);
    const qty = Number(item.quantity) || 0;
    if (prod?.depositType === 'damacana') result.damacana += qty;
    else if (prod?.depositType === 'cam_damacana') result.camDamacana += qty;
    else if (prod?.depositType === 'tup') result.tup += qty;
  }
  return result;
}

// Pure helper: delivered deposits minus empties physically collected from the customer.
// Positive value => customer keeps an outstanding empty-container liability.
export function computeEmptyContainersDiff(
  delivered: EmptiesCounts,
  received: { damacana?: number; camDamacana?: number; cam_damacana?: number; tup?: number }
): EmptiesCounts {
  const recvDamacana = Number(received.damacana) || 0;
  const recvCam = Number(received.camDamacana ?? received.cam_damacana) || 0;
  const recvTup = Number(received.tup) || 0;
  return {
    damacana: delivered.damacana - recvDamacana,
    camDamacana: delivered.camDamacana - recvCam,
    tup: delivered.tup - recvTup,
  };
}

function getLocalCustomerMap(): Map<string, Customer> {
  const map = new Map<string, Customer>();
  for (const c of loadLocalDatabase().customers) {
    map.set(c.id, c);
  }
  return map;
}

// Normalize edilmiş tablolardan (customer_empty_balances / customer_product_prices)
// müşteri ilişkilerini hızlı erişim için gruplar.
interface CustomerRelations {
  emptyByCustomer: Map<string, { damacana: number; camDamacana: number; tup: number }>;
  pricesByCustomer: Map<string, Record<string, number>>;
}

function emptyBucket(): { damacana: number; camDamacana: number; tup: number } {
  return { damacana: 0, camDamacana: 0, tup: 0 };
}

function buildCustomerRelations(emptyRows: any[], priceRows: any[]): CustomerRelations {
  const emptyByCustomer = new Map<string, { damacana: number; camDamacana: number; tup: number }>();
  const pricesByCustomer = new Map<string, Record<string, number>>();

  for (const r of emptyRows || []) {
    if (!r || typeof r.customer_id !== 'string') continue;
    const bucket = emptyByCustomer.get(r.customer_id) || emptyBucket();
    const qty = Number(r.quantity) || 0;
    if (r.deposit_type === 'damacana') bucket.damacana = qty;
    else if (r.deposit_type === 'cam_damacana') bucket.camDamacana = qty;
    else if (r.deposit_type === 'tup') bucket.tup = qty;
    emptyByCustomer.set(r.customer_id, bucket);
  }

  for (const r of priceRows || []) {
    if (!r || typeof r.customer_id !== 'string' || typeof r.product_id !== 'string') continue;
    const map = pricesByCustomer.get(r.customer_id) || {};
    map[r.product_id] = Number(r.unit_price) || 0;
    pricesByCustomer.set(r.customer_id, map);
  }

  return { emptyByCustomer, pricesByCustomer };
}

// Bir Customer nesnesinden ilişki haritalarını üretir (yazma sonrası dönüş için).
function relationsFromCustomer(cust: Customer): CustomerRelations {
  const emptyRows = DEPOSIT_BUCKETS.map((b) => {
    let value: any = (cust.emptyDepositBalance as any)?.[b.key];
    if (b.key === 'camDamacana' && value === undefined) value = (cust.emptyDepositBalance as any)?.cam_damacana;
    return { customer_id: cust.id, deposit_type: b.depositType, quantity: Number(value) || 0 };
  });
  const priceRows = Object.entries(cust.customPrices || {}).map(([product_id, unit_price]) => ({
    customer_id: cust.id,
    product_id,
    unit_price,
  }));
  return buildCustomerRelations(emptyRows, priceRows);
}

function mapCustomerFromDb(
  row: any,
  localCustomerById?: Map<string, Customer>,
  relations?: CustomerRelations
): Customer {
  let emails: string[] = [];
  if (Array.isArray(row.emails)) {
    emails = row.emails.filter((e: any) => typeof e === 'string' && e.trim());
  } else if (typeof row.emails === 'string' && row.emails.trim()) {
    try {
      const parsed = JSON.parse(row.emails);
      if (Array.isArray(parsed)) emails = parsed.filter((e: any) => typeof e === 'string' && e.trim());
      else emails = [row.emails.trim()];
    } catch {
      emails = row.emails.split(/[,;\s]+/).map((s: string) => s.trim()).filter((s: string) => s.includes('@'));
    }
  } else if (row.email && typeof row.email === 'string') {
    emails = [row.email.trim()];
  }

  // Also check if district column contains emails (as requested: "district yerine mail adresi")
  if (emails.length === 0 && typeof row.district === 'string' && row.district.trim()) {
    const dist = row.district.trim();
    if (dist.startsWith('[') && dist.endsWith(']')) {
      try {
        const parsed = JSON.parse(dist);
        if (Array.isArray(parsed)) emails = parsed.filter((e: any) => typeof e === 'string' && e.trim());
      } catch {}
    } else if (dist.includes('@')) {
      emails = dist.split(/[,;\s]+/).map((s: string) => s.trim()).filter((s: string) => s.includes('@'));
    }
  }

  // Merge with local store emails if available for that customer id
  const localCust = localCustomerById?.get(row.id);
  if (localCust?.emails && localCust.emails.length > 0) {
    localCust.emails.forEach((em) => {
      if (!emails.includes(em)) emails.push(em);
    });
  }

  // Deduplicate
  emails = Array.from(new Set(emails));

  const emptyDepositBalance = relations?.emptyByCustomer.get(row.id) || emptyBucket();
  const customPrices = relations?.pricesByCustomer.get(row.id) || {};

  return {
    id: row.id,
    name: row.name,
    phone: row.phone || '',
    address: row.address || '',
    emails,
    isAccountCustomer: Boolean(row.is_account_customer),
    currentBalanceTL: Number(row.current_balance_tl) || 0,
    emptyDepositBalance: {
      damacana: Number(emptyDepositBalance.damacana) || 0,
      camDamacana: Number(emptyDepositBalance.camDamacana) || 0,
      tup: Number(emptyDepositBalance.tup) || 0,
    },
    customPrices,
    notes: row.notes || '',
    createdDate: row.created_date || new Date().toISOString().split('T')[0],
  };
}

// ----------------------------------------------------------------------
// BOUNDED `.in()` CHUNKING HELPERS
//
// PostgREST encodes `.in('col', ids)` directly in the request URL. A large id
// list can exceed Node's ~16 KiB request-line limit (and many gateways reject
// > ~8 KiB), causing the query to fail silently. We split ids into small
// batches, run them with bounded concurrency and merge the rows, producing the
// exact same result set. A failed batch is logged and contributes nothing,
// which is the same behavior a single failing query had before.
// ----------------------------------------------------------------------
const IN_CHUNK_SIZE = 200;
const IN_CHUNK_CONCURRENCY = 4;

function chunkIds(ids: string[], size: number): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += size) batches.push(ids.slice(i, i + size));
  return batches;
}

type ChunkQuery = (batch: string[]) => PromiseLike<{ data: any[] | null; error: any }>;

async function fetchInChunks(ids: string[], makeQuery: ChunkQuery, errorLabel: string): Promise<any[]> {
  if (ids.length === 0) return [];
  const batches = chunkIds(ids, IN_CHUNK_SIZE);
  const rows: any[] = [];
  for (let i = 0; i < batches.length; i += IN_CHUNK_CONCURRENCY) {
    const group = batches.slice(i, i + IN_CHUNK_CONCURRENCY);
    const settled = await Promise.all(
      group.map((batch) =>
        Promise.resolve(makeQuery(batch)).catch((err) => ({ data: null, error: err }))
      )
    );
    for (const res of settled) {
      if (res.error) {
        console.error(errorLabel, res.error);
        continue;
      }
      if (res.data) rows.push(...res.data);
    }
  }
  return rows;
}

function groupRows<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
}

function mapDispatchFromDb(row: any, loadedItems: any[] = [], reconRows: any[] = []): Dispatch {
  const remainingFullExpected: Record<string, number> = {};
  const remainingFullCounted: Record<string, number> = {};
  for (const r of reconRows || []) {
    if (!r || typeof r.product_id !== 'string') continue;
    remainingFullExpected[r.product_id] = Number(r.expected_qty) || 0;
    remainingFullCounted[r.product_id] = Number(r.counted_qty) || 0;
  }

  const endOfDayReconciliation: Dispatch['endOfDayReconciliation'] = row.closed_at
    ? {
        closedAt: row.closed_at,
        closedByUserId: row.closed_by_user_id || '',
        closedByUserName: row.closed_by_user_name || '',
        remainingFullCounted,
        remainingFullExpected,
        collectedEmptyDamacana: Number(row.collected_empty_damacana) || 0,
        collectedEmptyCamDamacana: Number(row.collected_empty_cam_damacana) || 0,
        collectedEmptyTup: Number(row.collected_empty_tup) || 0,
        actualCashInPocket: Number(row.actual_cash_in_pocket) || 0,
        actualPosSlipsTotal: Number(row.actual_pos_slips_total) || 0,
        totalDeliveredValue: Number(row.total_delivered_value) || 0,
        totalCashCollected: Number(row.total_cash_collected) || 0,
        totalPosCollected: Number(row.total_pos_collected) || 0,
        totalCreditAdded: Number(row.total_credit_added) || 0,
        notes: row.reconciliation_notes || '',
      }
    : undefined;

  return {
    id: row.id,
    date: row.date,
    driverId: row.driver_id,
    driverName: row.driver_name,
    vehiclePlate: row.vehicle_plate,
    loadedByUserId: row.loaded_by_user_id,
    loadedByUserName: row.loaded_by_user_name,
    driverConfirmedAt: row.driver_confirmed_at,
    status: row.status,
    loadedItems: (loadedItems || []).map((i) => ({
      productId: i.product_id,
      quantity: Number(i.quantity) || 0,
    })),
    endOfDayReconciliation,
    createdAt: row.created_at || new Date().toISOString(),
  };
}

function mapDeliveryFromDb(row: any, itemRows: any[] = [], containerRows: any[] = []): Delivery {
  const deliveredItems = (itemRows || [])
    .slice()
    .sort((a, b) => (Number(a.line_no) || 0) - (Number(b.line_no) || 0))
    .map((r) => ({
      productId: r.product_id,
      productName: r.product_name,
      quantity: Number(r.quantity) || 0,
      unitPrice: Number(r.unit_price) || 0,
      lineTotal: Number(r.line_total) || 0,
    }));

  const emptyContainersReceived = { damacana: 0, camDamacana: 0, tup: 0 };
  const emptyContainersDiff = { damacana: 0, camDamacana: 0, tup: 0 };
  for (const r of containerRows || []) {
    if (!r) continue;
    const recv = Number(r.received_qty) || 0;
    const diff = Number(r.diff_qty) || 0;
    if (r.deposit_type === 'damacana') {
      emptyContainersReceived.damacana = recv;
      emptyContainersDiff.damacana = diff;
    } else if (r.deposit_type === 'cam_damacana') {
      emptyContainersReceived.camDamacana = recv;
      emptyContainersDiff.camDamacana = diff;
    } else if (r.deposit_type === 'tup') {
      emptyContainersReceived.tup = recv;
      emptyContainersDiff.tup = diff;
    }
  }

  return {
    id: row.id,
    dispatchId: row.dispatch_id,
    driverId: row.driver_id,
    driverName: row.driver_name,
    vehiclePlate: row.vehicle_plate,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerAddress: row.customer_address || '',
    customerPhone: row.customer_phone || '',
    timestamp: row.timestamp || new Date().toISOString(),
    deliveredItems,
    deliveredGrandTotal: Number(row.delivered_grand_total) || 0,
    collectedPayment: {
      method: row.payment_method || 'UNPAID',
      cashAmount: Number(row.cash_amount) || 0,
      posAmount: Number(row.pos_amount) || 0,
      totalCollected: Number(row.total_collected) || 0,
      status: row.payment_status || 'unpaid',
      diffUncollected: Number(row.diff_uncollected) || 0,
    },
    emptyContainersReceived,
    emptyContainersDiff,
    notes: row.notes || '',
    isOfflineSync: Boolean(row.is_offline_sync),
  };
}

// ----------------------------------------------------------------------
// NORMALIZED SCHEMA HELPERS (Supabase)
// ----------------------------------------------------------------------

// Ürün kategorilerini veritabanından (product_categories) okur; hata/boş durumda
// kanonik varsayılanlara düşer. Böylece kategori yönetimi veri odaklıdır.
export async function getProductCategories(): Promise<ProductCategoryInfo[]> {
  const fallback = (): ProductCategoryInfo[] =>
    PRODUCT_CATEGORIES_REF.map((c) => ({
      code: c.code,
      title: c.title_tr,
      order: c.sort_order,
      defaultUnit: c.default_unit,
      isDeposit: c.default_is_deposit,
      depositType: c.default_deposit_type,
    }));

  const mapRow = (row: any): ProductCategoryInfo => ({
    code: row.code,
    title: row.title_tr,
    order: Number(row.sort_order) || 99,
    defaultUnit: row.default_unit || 'Adet',
    isDeposit: Boolean(row.default_is_deposit),
    depositType: row.default_deposit_type || 'none',
  });

  if (isSupabaseOperational() && supabase) {
    try {
      const { data, error } = await supabase
        .from('product_categories')
        .select('*')
        .order('sort_order', { ascending: true });
      if (!error && data && data.length > 0) return data.map(mapRow);
      if (error) console.error('[Supabase getProductCategories]', error);
    } catch (e) {
      console.error('[Supabase getProductCategories Exception]', e);
    }
  } else if (pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM public.product_categories ORDER BY sort_order ASC');
      if (res.rows.length > 0) return res.rows.map(mapRow);
    } catch (e) {
      console.error('[Postgres getProductCategories]', e);
    }
  }

  return fallback();
}

// Tek bir müşterinin boş kap ve özel fiyat ilişkilerini okur.
async function fetchCustomerRelationsSupabase(customerId: string): Promise<CustomerRelations> {
  if (!supabase) return buildCustomerRelations([], []);
  const [emptyRes, priceRes] = await Promise.all([
    supabase
      .from('customer_empty_balances')
      .select('customer_id, deposit_type, quantity')
      .eq('customer_id', customerId),
    supabase
      .from('customer_product_prices')
      .select('customer_id, product_id, unit_price')
      .eq('customer_id', customerId),
  ]);
  if (emptyRes.error) console.error('[Supabase fetchCustomerRelations empties]', emptyRes.error);
  if (priceRes.error) console.error('[Supabase fetchCustomerRelations prices]', priceRes.error);
  return buildCustomerRelations(emptyRes.data || [], priceRes.data || []);
}

// Müşterinin boş kap ve özel fiyat kayıtlarını (normalize tablolar) yazar.
async function writeCustomerRelationsSupabase(
  customerId: string,
  empty?: Customer['emptyDepositBalance'],
  customPrices?: Record<string, number>
): Promise<void> {
  if (!supabase) return;

  if (empty) {
    const rows = DEPOSIT_BUCKETS.map((b) => {
      let value: any = (empty as any)[b.key];
      if (b.key === 'camDamacana' && value === undefined) value = (empty as any).cam_damacana;
      return {
        customer_id: customerId,
        deposit_type: b.depositType,
        quantity: Number(value) || 0,
        updated_at: new Date().toISOString(),
      };
    });
    const { error } = await supabase
      .from('customer_empty_balances')
      .upsert(rows, { onConflict: 'customer_id,deposit_type' });
    if (error) {
      console.error('[Supabase writeCustomerRelations empty]', error);
      throw new Error(toTurkishDbError(error, 'Müşteri boş kap bilgileri kaydedilemedi.'));
    }
  }

  if (customPrices) {
    // Birleştirme (merge) semantiği: verilmeyen ürünlerin fiyatı KORUNUR.
    // Açık silme yalnızca değeri null/undefined olan anahtarlarla yapılır.
    // Böylece boş veya kısmi bir harita mevcut fiyatları kazara silmez.
    const toDelete: string[] = [];
    const rows: Array<{ customer_id: string; product_id: string; unit_price: number; updated_at: string }> = [];
    for (const [product_id, raw] of Object.entries(customPrices)) {
      if (raw === null || raw === undefined) {
        toDelete.push(product_id);
        continue;
      }
      const price = Number(raw);
      if (Number.isNaN(price)) continue;
      rows.push({
        customer_id: customerId,
        product_id,
        unit_price: price,
        updated_at: new Date().toISOString(),
      });
    }
    if (rows.length > 0) {
      const ins = await supabase
        .from('customer_product_prices')
        .upsert(rows, { onConflict: 'customer_id,product_id' });
      if (ins.error) {
        console.error('[Supabase writeCustomerRelations insPrices]', ins.error);
        throw new Error(toTurkishDbError(ins.error, 'Müşteri özel fiyatları kaydedilemedi.'));
      }
    }
    if (toDelete.length > 0) {
      const del = await supabase
        .from('customer_product_prices')
        .delete()
        .eq('customer_id', customerId)
        .in('product_id', toDelete);
      if (del.error) {
        console.error('[Supabase writeCustomerRelations delPrices]', del.error);
        throw new Error(toTurkishDbError(del.error, 'Müşteri özel fiyatları güncellenemedi.'));
      }
    }
  }
}

// Postgres (pg.Pool veya pg.PoolClient) için müşteri özel fiyatlarını yazar.
// Supabase ile aynı birleştirme semantiği: verilmeyen ürünler korunur,
// yalnızca değeri null/undefined olan anahtarlar silinir.
interface PgQueryable {
  query: (text: string, values?: any[]) => Promise<any>;
}

async function writeCustomerPricesPg(
  db: PgQueryable,
  customerId: string,
  customPrices: Record<string, number>
): Promise<void> {
  const toDelete: string[] = [];
  const entries: Array<{ product_id: string; unit_price: number }> = [];
  for (const [product_id, raw] of Object.entries(customPrices || {})) {
    if (raw === null || raw === undefined) {
      toDelete.push(product_id);
      continue;
    }
    const price = Number(raw);
    if (Number.isNaN(price)) continue;
    entries.push({ product_id, unit_price: price });
  }

  if (entries.length > 0) {
    const values: any[] = [];
    const tuples = entries.map((entry, idx) => {
      values.push(customerId, entry.product_id, entry.unit_price);
      return `($${idx * 3 + 1}, $${idx * 3 + 2}, $${idx * 3 + 3})`;
    });
    await db.query(
      `INSERT INTO public.customer_product_prices (customer_id, product_id, unit_price)
       VALUES ${tuples.join(',')}
       ON CONFLICT (customer_id, product_id) DO UPDATE SET
         unit_price = EXCLUDED.unit_price, updated_at = now();`,
      values
    );
  }

  if (toDelete.length > 0) {
    await db.query(
      'DELETE FROM public.customer_product_prices WHERE customer_id = $1 AND product_id = ANY($2::text[])',
      [customerId, toDelete]
    );
  }
}

// Seferin yüklenen ürünlerini ve gün sonu mutabakat kalemlerini (normalize tablolar) yazar.
async function writeDispatchChildrenSupabase(
  dispatchId: string,
  loadedItems?: LoadedItem[],
  recon?: EndOfDayReconciliation
): Promise<void> {
  if (!supabase) return;

  if (loadedItems !== undefined) {
    const del = await supabase.from('dispatch_items').delete().eq('dispatch_id', dispatchId);
    if (del.error) {
      console.error('[Supabase writeDispatchChildren delItems]', del.error);
      throw new Error(toTurkishDbError(del.error, 'Sefer yükleme kalemleri güncellenemedi.'));
    }
    const rows = (loadedItems || [])
      .filter((i) => i && i.productId)
      .map((i) => ({
        dispatch_id: dispatchId,
        product_id: i.productId,
        quantity: Number(i.quantity) || 0,
      }));
    if (rows.length > 0) {
      const ins = await supabase.from('dispatch_items').insert(rows);
      if (ins.error) {
        console.error('[Supabase writeDispatchChildren insItems]', ins.error);
        throw new Error(toTurkishDbError(ins.error, 'Sefer yükleme kalemleri kaydedilemedi.'));
      }
    }
  }

  if (recon !== undefined) {
    const del = await supabase.from('dispatch_reconciliation_items').delete().eq('dispatch_id', dispatchId);
    if (del.error) {
      console.error('[Supabase writeDispatchChildren delRecon]', del.error);
      throw new Error(toTurkishDbError(del.error, 'Mutabakat kalemleri güncellenemedi.'));
    }
    const productIds = Array.from(
      new Set<string>([
        ...Object.keys(recon.remainingFullExpected || {}),
        ...Object.keys(recon.remainingFullCounted || {}),
      ])
    );
    const rows = productIds.map((product_id) => ({
      dispatch_id: dispatchId,
      product_id,
      expected_qty: Number(recon.remainingFullExpected?.[product_id]) || 0,
      counted_qty: Number(recon.remainingFullCounted?.[product_id]) || 0,
    }));
    if (rows.length > 0) {
      const ins = await supabase.from('dispatch_reconciliation_items').insert(rows);
      if (ins.error) {
        console.error('[Supabase writeDispatchChildren insRecon]', ins.error);
        throw new Error(toTurkishDbError(ins.error, 'Mutabakat kalemleri kaydedilemedi.'));
      }
    }
  }
}

// Gün sonu mutabakatının dispatches tablosundaki skaler kolonlara eşlemesi.
function dispatchReconScalarPatch(recon: EndOfDayReconciliation): Record<string, any> {
  return {
    closed_at: recon.closedAt,
    total_delivered_value: recon.totalDeliveredValue,
    total_cash_collected: recon.totalCashCollected,
    total_pos_collected: recon.totalPosCollected,
    total_credit_added: recon.totalCreditAdded,
    actual_cash_in_pocket: recon.actualCashInPocket,
    actual_pos_slips_total: recon.actualPosSlipsTotal,
    collected_empty_damacana: recon.collectedEmptyDamacana || 0,
    collected_empty_cam_damacana: recon.collectedEmptyCamDamacana || 0,
    collected_empty_tup: recon.collectedEmptyTup || 0,
    reconciliation_notes: recon.notes || '',
  };
}

// Doğrudan PostgreSQL bağlantısı için: mutabakat kalemlerini yazar.
async function writeDispatchReconPg(
  client: pg.PoolClient,
  dispatchId: string,
  recon: EndOfDayReconciliation
): Promise<void> {
  await client.query('DELETE FROM public.dispatch_reconciliation_items WHERE dispatch_id = $1', [dispatchId]);
  const productIds = Array.from(
    new Set<string>([
      ...Object.keys(recon.remainingFullExpected || {}),
      ...Object.keys(recon.remainingFullCounted || {}),
    ])
  );
  for (const pid of productIds) {
    await client.query(
      'INSERT INTO public.dispatch_reconciliation_items (dispatch_id, product_id, expected_qty, counted_qty) VALUES ($1, $2, $3, $4)',
      [
        dispatchId,
        pid,
        Number(recon.remainingFullExpected?.[pid]) || 0,
        Number(recon.remainingFullCounted?.[pid]) || 0,
      ]
    );
  }
}

// Doğrudan PostgreSQL bağlantısı için: tek seferi kalemleriyle okur.
async function readDispatchByIdPg(client: pg.PoolClient, id: string): Promise<Dispatch | null> {
  const row = await client.query('SELECT * FROM public.dispatches WHERE id = $1', [id]);
  if (!row.rows[0]) return null;
  const [items, recons] = await Promise.all([
    client.query('SELECT dispatch_id, product_id, quantity FROM public.dispatch_items WHERE dispatch_id = $1', [id]),
    client.query(
      'SELECT dispatch_id, product_id, expected_qty, counted_qty FROM public.dispatch_reconciliation_items WHERE dispatch_id = $1',
      [id]
    ),
  ]);
  return mapDispatchFromDb(row.rows[0], items.rows, recons.rows);
}

// Sefer işlemlerinde yinelenen aktif sefer kuralını anlaşılır Türkçe mesaja çevirir.
function toDispatchDbError(error: any, fallback: string): string {
  const code = String(error?.code || '');
  const msg = String(error?.message || '').toLowerCase();
  if (
    code === '23505' ||
    msg.includes('duplicate key') ||
    msg.includes('unique') ||
    msg.includes('ux_dispatches_active')
  ) {
    return 'Bu şoför veya araç plakası için zaten aktif bir dağıtım seferi bulunuyor. Önceki sefer kapatılmadan yeni sefer açılamaz.';
  }
  return toTurkishDbError(error, fallback);
}

// ----------------------------------------------------------------------
// SUPABASE WRITE ERROR HANDLING (Turkish messages + schema drift)
// ----------------------------------------------------------------------
// Optional customer columns that may be missing on older Supabase projects.
// If the remote table lacks one of these, we strip it and retry so that the
// customer is still persisted instead of silently falling back to local JSON.
const OPTIONAL_CUSTOMER_COLUMNS = ['emails'];

export function isMissingColumnError(error: any): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '').toLowerCase();
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the') ||
    (msg.includes('column') && msg.includes('schema cache'))
  );
}

function extractMissingColumn(error: any): string | undefined {
  const msg = String(error?.message || '');
  const m1 = msg.match(/column\s+"?([a-zA-Z0-9_.]+)"?\s+does not exist/i);
  if (m1) {
    const parts = m1[1].split('.');
    return parts[parts.length - 1];
  }
  const m2 = msg.match(/could not find the '([a-zA-Z0-9_]+)' column/i);
  if (m2) return m2[1];
  const m3 = msg.match(/column\s+'([a-zA-Z0-9_]+)'/i);
  if (m3) return m3[1];
  return undefined;
}

// Writes a customer row, transparently retrying without optional columns that
// the remote schema does not (yet) have. Returns the raw Supabase result.
async function upsertCustomerRow(payload: Record<string, any>): Promise<{ data: any; error: any }> {
  const working: Record<string, any> = { ...payload };
  let result = await supabase!.from('customers').upsert(working, { onConflict: 'id' }).select().single();

  let attempts = 0;
  while (result.error && isMissingColumnError(result.error) && attempts <= OPTIONAL_CUSTOMER_COLUMNS.length) {
    const parsed = extractMissingColumn(result.error);
    const col =
      (parsed && working[parsed] !== undefined ? parsed : undefined) ||
      OPTIONAL_CUSTOMER_COLUMNS.find((c) => working[c] !== undefined);
    if (!col || working[col] === undefined) break;
    console.warn(`[Supabase createCustomer] '${col}' kolonu bulunamadı, bu alan atlanarak tekrar deneniyor.`);
    delete working[col];
    result = await supabase!.from('customers').upsert(working, { onConflict: 'id' }).select().single();
    attempts++;
  }

  return result;
}

async function updateCustomerRow(id: string, payload: Record<string, any>): Promise<{ data: any; error: any }> {
  const working: Record<string, any> = { ...payload };
  if (Object.keys(working).length === 0) return { data: null, error: null };
  let result = await supabase!.from('customers').update(working).eq('id', id).select().single();

  let attempts = 0;
  while (result.error && isMissingColumnError(result.error) && attempts <= OPTIONAL_CUSTOMER_COLUMNS.length) {
    const parsed = extractMissingColumn(result.error);
    const col =
      (parsed && working[parsed] !== undefined ? parsed : undefined) ||
      OPTIONAL_CUSTOMER_COLUMNS.find((c) => working[c] !== undefined);
    if (!col || working[col] === undefined) break;
    console.warn(`[Supabase updateCustomer] '${col}' kolonu bulunamadı, bu alan atlanarak tekrar deneniyor.`);
    delete working[col];
    if (Object.keys(working).length === 0) return { data: null, error: null };
    result = await supabase!.from('customers').update(working).eq('id', id).select().single();
    attempts++;
  }

  return result;
}

function toTurkishDbError(error: any, fallback: string): string {
  const code = String(error?.code || '');
  const msg = String(error?.message || '').toLowerCase();
  if (code === '23505' || msg.includes('duplicate key')) {
    return 'Bu kayıt zaten mevcut. Yinelenen kayıt oluşturulamaz.';
  }
  if (code === '23503' || msg.includes('foreign key')) {
    return 'İlişkili kayıt bulunamadığı için işlem tamamlanamadı.';
  }
  if (code === '23502' || msg.includes('not-null') || msg.includes('null value')) {
    return 'Zorunlu alanlar boş bırakılamaz.';
  }
  if (code === '42501' || msg.includes('row-level security') || msg.includes('permission denied')) {
    return 'Bu işlem için veritabanı yetkiniz bulunmuyor.';
  }
  if (code === '42P01' || msg.includes('does not exist')) {
    return 'Veritabanı tablosu veya alanı bulunamadı. Lütfen sistem yöneticisiyle iletişime geçin.';
  }
  return fallback;
}

// ----------------------------------------------------------------------
// AUTO-SEED SUPABASE WHEN CONNECTED BUT EMPTY
// ----------------------------------------------------------------------
let hasAttemptedSeed = false;

export async function ensureSupabaseSeeded(): Promise<void> {
  if (hasAttemptedSeed) return;
  hasAttemptedSeed = true;

  if (isSupabaseOperational() && supabase) {
    try {
      // Kullanıcı (public.users) ve müşteri kayıtlarına ASLA dokunulmaz.
      // Yalnızca referans verisi (depozito türleri, kategoriler, ürün kataloğu)
      // boş olduğunda eklenir; var olan kayıtlar korunur.
      const { count, error } = await supabase
        .from('product_categories')
        .select('code', { count: 'exact', head: true });

      if (error) {
        console.warn('[Supabase AutoSeed] Kategori kontrolü başarısız, ekim atlandı.', error.message);
        return;
      }
      if (typeof count === 'number' && count > 0) return;

      console.log('[Supabase] Referans verisi (depozito türleri, kategoriler, ürünler) yükleniyor...');

      const depRes = await supabase
        .from('deposit_types')
        .upsert(DEPOSIT_TYPES_REF, { onConflict: 'code', ignoreDuplicates: true });
      if (depRes.error) console.error('[Supabase AutoSeed] deposit_types', depRes.error);

      const catRes = await supabase
        .from('product_categories')
        .upsert(PRODUCT_CATEGORIES_REF, { onConflict: 'code', ignoreDuplicates: true });
      if (catRes.error) console.error('[Supabase AutoSeed] product_categories', catRes.error);

      // data_store.json'daki eski kayıtlar KULLANILMAZ; kanonik katalog ekilir.
      const prodRows = CANONICAL_SEED_PRODUCTS.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        default_unit_price: p.defaultUnitPrice,
        is_deposit: p.isDeposit,
        deposit_type: p.depositType,
        unit: p.unit,
        description: p.description,
        is_active: true,
      }));
      if (prodRows.length > 0) {
        const pRes = await supabase
          .from('products')
          .upsert(prodRows, { onConflict: 'id', ignoreDuplicates: true });
        if (pRes.error) console.error('[Supabase AutoSeed] products', pRes.error);
      }

      console.log('[Supabase] Referans verisi ekimi tamamlandı.');
    } catch (e) {
      console.error('[Supabase AutoSeed Error]', e);
    }
  }
}

// ----------------------------------------------------------------------
// UNIFIED DATA OPERATIONS (SUPABASE, POSTGRES OR LOCAL FALLBACK)
// ----------------------------------------------------------------------

// 1. Users
export async function getUsers(): Promise<User[]> {
  if (isSupabaseOperational() && supabase) {
    try {
      const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: true });
      if (!error && data && data.length > 0) return data.map(mapUserFromDb);
      if (data && data.length === 0) {
        await ensureSupabaseSeeded();
        const retry = await supabase.from('users').select('*').order('created_at', { ascending: true });
        if (!retry.error && retry.data && retry.data.length > 0) return retry.data.map(mapUserFromDb);
      }
      if (error) console.error('[Supabase getUsers]', error);
    } catch (e) {
      console.error('[Supabase getUsers Exception]', e);
    }
  } else if (pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM public.users ORDER BY created_at ASC');
      if (res.rows.length > 0) return res.rows.map(mapUserFromDb);
    } catch (e) {
      console.error('[Postgres getUsers]', e);
    }
  }

  return loadLocalDatabase().users;
}

export async function createUser(user: User): Promise<User> {
  if (isSupabaseOperational() && supabase) {
    try {
      const { data, error } = await supabase
        .from('users')
        .upsert(
          {
            id: user.id,
            name: user.name,
            username: user.username,
            role: user.role,
            can_load_vehicle: user.canLoadVehicle,
            assigned_plate: user.assignedPlate,
            pin: user.pin,
            phone: user.phone,
          },
          { onConflict: 'id' }
        )
        .select()
        .single();

      if (!error && data) return mapUserFromDb(data);
      console.error('[Supabase createUser]', error);
    } catch (e) {
      console.error('[Supabase createUser Exception]', e);
    }
  } else if (pgPool) {
    try {
      const q = `
        INSERT INTO public.users (id, name, username, role, can_load_vehicle, assigned_plate, pin, phone)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          username = EXCLUDED.username,
          role = EXCLUDED.role,
          can_load_vehicle = EXCLUDED.can_load_vehicle,
          assigned_plate = EXCLUDED.assigned_plate,
          pin = EXCLUDED.pin,
          phone = EXCLUDED.phone
        RETURNING *;
      `;
      const res = await pgPool.query(q, [
        user.id,
        user.name,
        user.username,
        user.role,
        user.canLoadVehicle,
        user.assignedPlate || '',
        user.pin,
        user.phone || '',
      ]);
      if (res.rows[0]) return mapUserFromDb(res.rows[0]);
    } catch (e) {
      console.error('[Postgres createUser]', e);
    }
  }

  const db = loadLocalDatabase();
  const idx = db.users.findIndex((u) => u.id === user.id);
  if (idx !== -1) {
    db.users[idx] = user;
  } else {
    db.users.push(user);
  }
  saveLocalDatabase(db);
  return user;
}

export async function updateUser(id: string, updates: Partial<User>): Promise<User | null> {
  if (isSupabaseOperational() && supabase) {
    try {
      const payload: any = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.username !== undefined) payload.username = updates.username;
      if (updates.role !== undefined) payload.role = updates.role;
      if (updates.canLoadVehicle !== undefined) payload.can_load_vehicle = updates.canLoadVehicle;
      if (updates.assignedPlate !== undefined) payload.assigned_plate = updates.assignedPlate;
      if (updates.pin !== undefined) payload.pin = updates.pin;
      if (updates.phone !== undefined) payload.phone = updates.phone;

      const { data, error } = await supabase
        .from('users')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (!error && data) return mapUserFromDb(data);
      console.error('[Supabase updateUser]', error);
    } catch (e) {
      console.error('[Supabase updateUser Exception]', e);
    }
  }

  const db = loadLocalDatabase();
  const idx = db.users.findIndex((u) => u.id === id);
  if (idx === -1) return null;
  db.users[idx] = { ...db.users[idx], ...updates };
  saveLocalDatabase(db);
  return db.users[idx];
}

// 2. Products
export async function getProducts(): Promise<Product[]> {
  if (isSupabaseOperational() && supabase) {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        // Postgres tarafındaki `is_active IS NOT FALSE` ile aynı anlam: NULL da aktif sayılır.
        .or('is_active.eq.true,is_active.is.null')
        .order('created_at', { ascending: true });
      if (!error && data) return data.map(mapProductFromDb);
      if (error) console.error('[Supabase getProducts]', error);
    } catch (e) {
      console.error('[Supabase getProducts Exception]', e);
    }
  } else if (pgPool) {
    try {
      const res = await pgPool.query(
        'SELECT * FROM public.products WHERE is_active IS NOT FALSE ORDER BY created_at ASC'
      );
      if (res.rows.length > 0) return res.rows.map(mapProductFromDb);
    } catch (e) {
      console.error('[Postgres getProducts]', e);
    }
  }

  return loadLocalDatabase().products;
}

export async function createProduct(product: Product): Promise<Product> {
  if (isSupabaseOperational() && supabase) {
    try {
      const { data, error } = await supabase
        .from('products')
        .upsert(
          {
            id: product.id,
            name: product.name,
            category: product.category,
            default_unit_price: product.defaultUnitPrice,
            is_deposit: product.isDeposit,
            deposit_type: product.depositType,
            unit: product.unit,
            description: product.description,
            is_active: true,
          },
          { onConflict: 'id' }
        )
        .select()
        .single();

      if (!error && data) return mapProductFromDb(data);
      console.error('[Supabase createProduct]', error);
    } catch (e) {
      console.error('[Supabase createProduct Exception]', e);
    }
  } else if (pgPool) {
    try {
      const res = await pgPool.query(
        `INSERT INTO public.products (id, name, category, default_unit_price, is_deposit, deposit_type, unit, description, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           default_unit_price = EXCLUDED.default_unit_price,
           is_deposit = EXCLUDED.is_deposit,
           deposit_type = EXCLUDED.deposit_type,
           unit = EXCLUDED.unit,
           description = EXCLUDED.description,
           is_active = true
         RETURNING *;`,
        [
          product.id,
          product.name,
          product.category,
          product.defaultUnitPrice,
          product.isDeposit,
          product.depositType,
          product.unit,
          product.description || '',
        ]
      );
      if (res.rows[0]) return mapProductFromDb(res.rows[0]);
    } catch (e) {
      console.error('[Postgres createProduct]', e);
    }
  }

  const db = loadLocalDatabase();
  db.products.push(product);
  saveLocalDatabase(db);
  return product;
}

export async function updateProduct(id: string, updates: Partial<Product>): Promise<Product | null> {
  if (isSupabaseOperational() && supabase) {
    try {
      const payload: any = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.category !== undefined) payload.category = updates.category;
      if (updates.defaultUnitPrice !== undefined) payload.default_unit_price = updates.defaultUnitPrice;
      if (updates.isDeposit !== undefined) payload.is_deposit = updates.isDeposit;
      if (updates.depositType !== undefined) payload.deposit_type = updates.depositType;
      if (updates.unit !== undefined) payload.unit = updates.unit;
      if (updates.description !== undefined) payload.description = updates.description;

      const { data, error } = await supabase
        .from('products')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (!error && data) return mapProductFromDb(data);
      console.error('[Supabase updateProduct]', error);
    } catch (e) {
      console.error('[Supabase updateProduct Exception]', e);
    }
  } else if (pgPool) {
    try {
      const fieldMap: Record<string, string> = {
        name: 'name',
        category: 'category',
        defaultUnitPrice: 'default_unit_price',
        isDeposit: 'is_deposit',
        depositType: 'deposit_type',
        unit: 'unit',
        description: 'description',
      };
      const sets: string[] = [];
      const values: any[] = [];
      let i = 1;
      for (const [key, col] of Object.entries(fieldMap)) {
        if ((updates as any)[key] !== undefined) {
          sets.push(`${col} = $${i++}`);
          values.push((updates as any)[key]);
        }
      }
      if (sets.length === 0) return null;
      values.push(id);
      const res = await pgPool.query(
        `UPDATE public.products SET ${sets.join(', ')} WHERE id = $${i} RETURNING *;`,
        values
      );
      if (res.rows[0]) return mapProductFromDb(res.rows[0]);
      return null;
    } catch (e) {
      console.error('[Postgres updateProduct]', e);
    }
  }

  const db = loadLocalDatabase();
  const idx = db.products.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  db.products[idx] = { ...db.products[idx], ...updates };
  saveLocalDatabase(db);
  return db.products[idx];
}

export async function deleteProduct(id: string): Promise<boolean> {
  // Ürün geçmiş teslimat/yükleme kayıtlarında referanslı olabileceği için
  // kalıcı silme yerine pasife alınır (is_active = false). Geçmiş veriler korunur.
  if (isSupabaseOperational() && supabase) {
    try {
      const { error } = await supabase
        .from('products')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) console.error('[Supabase deleteProduct]', error);
    } catch (e) {
      console.error('[Supabase deleteProduct Exception]', e);
    }
  } else if (pgPool) {
    try {
      await pgPool.query('UPDATE public.products SET is_active = false, updated_at = now() WHERE id = $1', [id]);
    } catch (e) {
      console.error('[Postgres deleteProduct]', e);
    }
  }

  const db = loadLocalDatabase();
  db.products = db.products.filter((p) => p.id !== id);
  saveLocalDatabase(db);
  return true;
}

// 3. Customers
export async function getCustomers(): Promise<Customer[]> {
  if (isSupabaseOperational() && supabase) {
    try {
      const { data, error } = await supabase.from('customers').select('*').order('name', { ascending: true });
      if (!error && data) {
        const [priceRes, emptyRes] = await Promise.all([
          supabase.from('customer_product_prices').select('customer_id, product_id, unit_price'),
          supabase.from('customer_empty_balances').select('customer_id, deposit_type, quantity'),
        ]);
        if (priceRes.error) console.error('[Supabase getCustomers prices]', priceRes.error);
        if (emptyRes.error) console.error('[Supabase getCustomers empties]', emptyRes.error);
        const relations = buildCustomerRelations(emptyRes.data || [], priceRes.data || []);
        const localMap = getLocalCustomerMap();
        return data.map((row) => mapCustomerFromDb(row, localMap, relations));
      }
      if (error) console.error('[Supabase getCustomers]', error);
    } catch (e) {
      console.error('[Supabase getCustomers Exception]', e);
    }
  } else if (pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM public.customers ORDER BY name ASC');
      if (res.rows.length > 0) {
        const empties = await pgPool.query(
          'SELECT customer_id, deposit_type, quantity FROM public.customer_empty_balances'
        );
        const prices = await pgPool.query(
          'SELECT customer_id, product_id, unit_price FROM public.customer_product_prices'
        );
        const relations = buildCustomerRelations(empties.rows, prices.rows);
        const localMap = getLocalCustomerMap();
        return res.rows.map((row) => mapCustomerFromDb(row, localMap, relations));
      }
    } catch (e) {
      console.error('[Postgres getCustomers]', e);
    }
  }

  return loadLocalDatabase().customers;
}

export async function createCustomer(cust: Customer): Promise<Customer> {
  if (isSupabaseOperational() && supabase) {
    try {
      const payload: any = {
        id: cust.id,
        name: cust.name,
        phone: cust.phone,
        address: cust.address,
        is_account_customer: cust.isAccountCustomer,
        current_balance_tl: cust.currentBalanceTL,
        notes: cust.notes || '',
        created_date: cust.createdDate,
      };
      if (cust.emails !== undefined) {
        payload.emails = cust.emails;
      }

      const { data, error } = await upsertCustomerRow(payload);

      if (!error && data) {
        // Boş kap ve özel fiyat kayıtları normalize tablolara yazılır.
        await writeCustomerRelationsSupabase(cust.id, cust.emptyDepositBalance, cust.customPrices);
        return mapCustomerFromDb({ ...data, emails: cust.emails }, undefined, relationsFromCustomer(cust));
      }

      // Supabase yapılandırılmışsa hata sessizce yutulmaz; çağırana bildirilir.
      console.error('[Supabase createCustomer]', error);
      throw new Error(
        toTurkishDbError(error, 'Müşteri veritabanına kaydedilemedi. Lütfen tekrar deneyin.')
      );
    } catch (e: any) {
      console.error('[Supabase createCustomer Exception]', e);
      if (e instanceof Error) throw e;
      throw new Error(
        toTurkishDbError(e, 'Müşteri veritabanına kaydedilemedi. Lütfen tekrar deneyin.')
      );
    }
  } else if (pgPool) {
    try {
      const res = await pgPool.query(
        `INSERT INTO public.customers (id, name, phone, address, emails, is_account_customer, current_balance_tl, notes, created_date)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           phone = EXCLUDED.phone,
           address = EXCLUDED.address,
           emails = EXCLUDED.emails,
           is_account_customer = EXCLUDED.is_account_customer,
           current_balance_tl = EXCLUDED.current_balance_tl,
           notes = EXCLUDED.notes,
           created_date = EXCLUDED.created_date
         RETURNING *;`,
        [
          cust.id,
          cust.name,
          cust.phone,
          cust.address,
          JSON.stringify(cust.emails || []),
          cust.isAccountCustomer,
          cust.currentBalanceTL,
          cust.notes || '',
          cust.createdDate,
        ]
      );
      const empty: any = cust.emptyDepositBalance || { damacana: 0, camDamacana: 0, tup: 0 };
      await pgPool.query(
        `INSERT INTO public.customer_empty_balances (customer_id, deposit_type, quantity)
         VALUES ($1, 'damacana', $2), ($1, 'cam_damacana', $3), ($1, 'tup', $4)
         ON CONFLICT (customer_id, deposit_type) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();`,
        [
          cust.id,
          Number(empty.damacana) || 0,
          Number(empty.camDamacana ?? empty.cam_damacana) || 0,
          Number(empty.tup) || 0,
        ]
      );
      await writeCustomerPricesPg(pgPool, cust.id, cust.customPrices || {});
      if (res.rows[0]) return mapCustomerFromDb(res.rows[0], undefined, relationsFromCustomer(cust));
    } catch (e) {
      console.error('[Postgres createCustomer]', e);
    }
  }

  const db = loadLocalDatabase();
  const idx = db.customers.findIndex((c) => c.id === cust.id);
  if (idx !== -1) {
    db.customers[idx] = cust;
  } else {
    db.customers.push(cust);
  }
  saveLocalDatabase(db);
  return cust;
}

export async function updateCustomer(id: string, updates: Partial<Customer>): Promise<Customer | null> {
  // Mutlak bakiye/boş kap yazımı yalnızca beklenen değer kontrollü atomik
  // yoldan (adminUpdateCustomerAtomic) yapılabilir. Genel profil güncellemesi
  // eşzamanlı teslimatların oluşturduğu delta değişikliklerini ezemez.
  if (updates.currentBalanceTL !== undefined || updates.emptyDepositBalance !== undefined) {
    throw new DispatchDbError(
      'VALIDATION_ERROR',
      'Bakiye veya boş kap bakiyesi bu yoldan güncellenemez; atomik müşteri düzeltmesi kullanılmalıdır.'
    );
  }

  if (isSupabaseOperational() && supabase) {
    try {
      const payload: any = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.phone !== undefined) payload.phone = updates.phone;
      if (updates.address !== undefined) payload.address = updates.address;
      if (updates.emails !== undefined) payload.emails = updates.emails;
      if (updates.isAccountCustomer !== undefined) payload.is_account_customer = updates.isAccountCustomer;
      if (updates.currentBalanceTL !== undefined) payload.current_balance_tl = updates.currentBalanceTL;
      if (updates.notes !== undefined) payload.notes = updates.notes;

      let data: any = null;
      if (Object.keys(payload).length > 0) {
        const res = await updateCustomerRow(id, payload);
        if (res.error) {
          console.error('[Supabase updateCustomer]', res.error);
          throw new Error(
            toTurkishDbError(res.error, 'Müşteri bilgileri güncellenemedi. Lütfen tekrar deneyin.')
          );
        }
        data = res.data;
      }

      if (updates.emptyDepositBalance !== undefined || updates.customPrices !== undefined) {
        await writeCustomerRelationsSupabase(id, updates.emptyDepositBalance, updates.customPrices);
      }

      if (!data) {
        const base = await supabase.from('customers').select('*').eq('id', id).single();
        if (base.error || !base.data) return null;
        data = base.data;
      }

      const relations = await fetchCustomerRelationsSupabase(id);
      return mapCustomerFromDb({ ...data, emails: updates.emails ?? data.emails }, undefined, relations);
    } catch (e: any) {
      console.error('[Supabase updateCustomer Exception]', e);
      if (e instanceof Error) throw e;
      throw new Error(
        toTurkishDbError(e, 'Müşteri bilgileri güncellenemedi. Lütfen tekrar deneyin.')
      );
    }
  } else if (pgPool) {
    try {
      const sets: string[] = [];
      const values: any[] = [];
      let i = 1;
      const add = (col: string, val: any, cast = '') => {
        sets.push(`${col} = $${i++}${cast}`);
        values.push(val);
      };
      if (updates.name !== undefined) add('name', updates.name);
      if (updates.phone !== undefined) add('phone', updates.phone);
      if (updates.address !== undefined) add('address', updates.address);
      if (updates.emails !== undefined) add('emails', JSON.stringify(updates.emails), '::jsonb');
      if (updates.isAccountCustomer !== undefined) add('is_account_customer', updates.isAccountCustomer);
      if (updates.currentBalanceTL !== undefined) add('current_balance_tl', updates.currentBalanceTL);
      if (updates.notes !== undefined) add('notes', updates.notes);

      if (sets.length > 0) {
        values.push(id);
        await pgPool.query(
          `UPDATE public.customers SET ${sets.join(', ')} WHERE id = $${i} RETURNING *;`,
          values
        );
      }

      if (updates.emptyDepositBalance !== undefined) {
        const empty: any = updates.emptyDepositBalance || {};
        await pgPool.query(
          `INSERT INTO public.customer_empty_balances (customer_id, deposit_type, quantity)
           VALUES ($1, 'damacana', $2), ($1, 'cam_damacana', $3), ($1, 'tup', $4)
           ON CONFLICT (customer_id, deposit_type) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();`,
          [
            id,
            Number(empty.damacana) || 0,
            Number(empty.camDamacana ?? empty.cam_damacana) || 0,
            Number(empty.tup) || 0,
          ]
        );
      }

      if (updates.customPrices !== undefined) {
        await writeCustomerPricesPg(pgPool, id, updates.customPrices || {});
      }

      const base = await pgPool.query('SELECT * FROM public.customers WHERE id = $1', [id]);
      if (!base.rows[0]) return null;
      const empties = await pgPool.query(
        'SELECT customer_id, deposit_type, quantity FROM public.customer_empty_balances WHERE customer_id = $1',
        [id]
      );
      const prices = await pgPool.query(
        'SELECT customer_id, product_id, unit_price FROM public.customer_product_prices WHERE customer_id = $1',
        [id]
      );
      return mapCustomerFromDb(base.rows[0], undefined, buildCustomerRelations(empties.rows, prices.rows));
    } catch (e) {
      console.error('[Postgres updateCustomer]', e);
    }
  }

  const db = loadLocalDatabase();
  const idx = db.customers.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  db.customers[idx] = { ...db.customers[idx], ...updates };
  saveLocalDatabase(db);
  return db.customers[idx];
}

// 4. Dispatches
export async function getDispatches(date?: string): Promise<Dispatch[]> {
  if (isSupabaseOperational() && supabase) {
    try {
      let query = supabase.from('dispatches').select('*').order('created_at', { ascending: false });
      if (date) query = query.eq('date', date);
      const { data, error } = await query;
      if (!error && data) {
        const ids = data.map((d: any) => d.id);
        const [items, recons] = await Promise.all([
          fetchInChunks(
            ids,
            (batch) =>
              supabase!
                .from('dispatch_items')
                .select('dispatch_id, product_id, quantity')
                .in('dispatch_id', batch),
            '[Supabase getDispatches items]'
          ),
          fetchInChunks(
            ids,
            (batch) =>
              supabase!
                .from('dispatch_reconciliation_items')
                .select('dispatch_id, product_id, expected_qty, counted_qty')
                .in('dispatch_id', batch),
            '[Supabase getDispatches recon]'
          ),
        ]);
        const itemsByDispatch = groupRows(items, (i: any) => i.dispatch_id);
        const reconsByDispatch = groupRows(recons, (r: any) => r.dispatch_id);
        return data.map((row: any) =>
          mapDispatchFromDb(
            row,
            itemsByDispatch.get(row.id) || [],
            reconsByDispatch.get(row.id) || []
          )
        );
      }
      console.error('[Supabase getDispatches]', error);
    } catch (e) {
      console.error('[Supabase getDispatches Exception]', e);
    }
  } else if (pgPool) {
    try {
      let q = 'SELECT * FROM public.dispatches';
      const params: any[] = [];
      if (date) {
        q += ' WHERE date = $1';
        params.push(date);
      }
      q += ' ORDER BY created_at DESC';
      const res = await pgPool.query(q, params);
      const ids = res.rows.map((r) => r.id);
      let items: any[] = [];
      let recons: any[] = [];
      if (ids.length > 0) {
        const [iRes, rRes] = await Promise.all([
          pgPool.query(
            'SELECT dispatch_id, product_id, quantity FROM public.dispatch_items WHERE dispatch_id = ANY($1::text[])',
            [ids]
          ),
          pgPool.query(
            'SELECT dispatch_id, product_id, expected_qty, counted_qty FROM public.dispatch_reconciliation_items WHERE dispatch_id = ANY($1::text[])',
            [ids]
          ),
        ]);
        items = iRes.rows;
        recons = rRes.rows;
      }
      return res.rows.map((row) =>
        mapDispatchFromDb(
          row,
          items.filter((i) => i.dispatch_id === row.id),
          recons.filter((r) => r.dispatch_id === row.id)
        )
      );
    } catch (e) {
      console.error('[Postgres getDispatches]', e);
    }
  }

  let list = loadLocalDatabase().dispatches;
  if (date) list = list.filter((d) => d.date === date);
  return list;
}

// Tek bir seferi, yükleme ve mutabakat kalemleriyle birlikte okur.
async function getDispatchByIdSupabase(id: string): Promise<Dispatch | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('dispatches').select('*').eq('id', id).maybeSingle();
  if (error || !data) {
    if (error) console.error('[Supabase getDispatchById]', error);
    return null;
  }
  const [iRes, rRes] = await Promise.all([
    supabase
      .from('dispatch_items')
      .select('dispatch_id, product_id, quantity')
      .eq('dispatch_id', id),
    supabase
      .from('dispatch_reconciliation_items')
      .select('dispatch_id, product_id, expected_qty, counted_qty')
      .eq('dispatch_id', id),
  ]);
  return mapDispatchFromDb(data, iRes.data || [], rRes.data || []);
}

// ----------------------------------------------------------------------
// ATOMIC DISPATCH TRANSITIONS (Supabase RPC / Postgres / local fallback)
// ----------------------------------------------------------------------

function sanitizeQuantityMap(input: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, raw] of Object.entries(input)) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 120) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) out[key] = Math.floor(value);
  }
  return out;
}

function sanitizeMoney(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

function parseDispatchOperationError(e: any, fnName: string): DispatchDbError {
  const raw = `${e?.message || ''} ${e?.details || ''} ${e?.hint || ''}`.trim();

  if (/DISPATCH_ALREADY_COMPLETED/.test(raw)) {
    return new DispatchDbError(
      'DISPATCH_ALREADY_COMPLETED',
      'Sefer zaten kapatılmış. Değişiklik için yönetici seferi yeniden açmalıdır.'
    );
  }
  if (/DISPATCH_NOT_FOUND/.test(raw)) {
    return new DispatchDbError('DISPATCH_NOT_FOUND', 'Sefer bulunamadı.');
  }
  if (/INVALID_DISPATCH_STATE/.test(raw)) {
    return new DispatchDbError('INVALID_DISPATCH_STATE', 'Sefer bu işlem için uygun durumda değil.');
  }
  if (/CUSTOMER_NOT_FOUND/.test(raw)) {
    return new DispatchDbError('CUSTOMER_NOT_FOUND', 'Müşteri bulunamadı.');
  }
  if (/EXPECTATION_REQUIRED/.test(raw)) {
    return new DispatchDbError(
      'EXPECTATION_REQUIRED',
      'Güncelleme için beklenen güncel değer zorunludur.'
    );
  }
  if (/HISTORICAL_DELIVERY_ITEMS_MISSING/.test(raw)) {
    return new DispatchDbError(
      'HISTORICAL_DELIVERY_ITEMS_MISSING',
      'Bu seferde kalem kayıtları eksik eski teslimatlar var. Gün sonu kapatma güvenli biçimde yapılamaz; yönetici düzeltmesi gerekir.'
    );
  }
  if (/PAYMENT_DATA_INCONSISTENT/.test(raw)) {
    return new DispatchDbError(
      'PAYMENT_DATA_INCONSISTENT',
      'Teslimat ödeme tutarları birbiriyle uyuşmuyor. Eski/eksik ödeme verisi kapatmaya yansıtılamaz; yönetici düzeltmesi gerekir.'
    );
  }
  if (/HISTORICAL_REOPEN_BLOCKED/.test(raw)) {
    return new DispatchDbError(
      'HISTORICAL_REOPEN_BLOCKED',
      'Kapanış zamanı doğrulanmamış eski sefer güvenli biçimde yeniden açılamaz. Yönetici düzeltme süreci gerekir.'
    );
  }
  if (/INSUFFICIENT_VEHICLE_STOCK/.test(raw)) {
    return new DispatchDbError(
      'INSUFFICIENT_VEHICLE_STOCK',
      'Araçta bu üründen yeterli stok yok. Teslimat miktarı yüklenen miktarı aşamaz.'
    );
  }
  if (/CLOSE_WRITE_NOT_APPLIED|REOPEN_WRITE_NOT_APPLIED|CUSTOMER_UPDATE_NOT_APPLIED/.test(raw)) {
    return new DispatchDbError(
      'WRITE_NOT_APPLIED',
      'Veritabanı güncellemesi uygulanmadı. Lütfen sistem yöneticisiyle iletişime geçin.'
    );
  }
  if (/NOT_AUTHORIZED/.test(raw)) {
    return new DispatchDbError('NOT_AUTHORIZED', 'Bu işlem için yönetici yetkisi gereklidir.');
  }
  if (/VALIDATION_ERROR/.test(raw) || String(e?.code || '') === '23503') {
    return new DispatchDbError('VALIDATION_ERROR', 'Gönderilen bilgiler geçersiz.');
  }
  if (String(e?.code || '') === '23505') {
    return new DispatchDbError('VALIDATION_ERROR', 'Aynı kayıt birden fazla kez gönderilemez.');
  }
  if (hasRpcMissingSignature(e)) {
    return new DispatchDbError(
      'MIGRATION_REQUIRED',
      `Sunucu veritabanı güncellemesi eksik: ${fnName} fonksiyonu bulunamadı. Yöneticiye bildirin.`
    );
  }
  return new DispatchDbError(
    'DB_ERROR',
    toTurkishDbError(e, 'Sefer işlemi veritabanında tamamlanamadı. Lütfen tekrar deneyin.')
  );
}

async function readDispatchById(id: string): Promise<Dispatch | null> {
  if (isSupabaseOperational() && supabase) {
    return getDispatchByIdSupabase(id);
  }
  const all = await getDispatches();
  return all.find((d) => d.id === id) || null;
}

// Şoför onayı: yalnızca pending_confirmation -> in_transit geçişine izin verir.
// UPDATE ... WHERE status='pending_confirmation' atomiktir; eşzamanlı kapatma
// ile yarışta kapatılmış sefer tekrar "in_transit" yapılamaz.
export async function confirmDispatchAtomic(
  id: string
): Promise<{ dispatch: Dispatch; changed: boolean }> {
  const now = new Date().toISOString();

  if (isSupabaseOperational() && supabase) {
    try {
      const { data, error } = await supabase
        .from('dispatches')
        .update({ status: 'in_transit', driver_confirmed_at: now })
        .eq('id', id)
        .eq('status', 'pending_confirmation')
        .select('id');
      if (error) throw error;

      if (data && data.length > 0) {
        const updated = await getDispatchByIdSupabase(id);
        if (!updated) {
          throw new DispatchDbError(
            'DB_ERROR',
            'Sefer onaylandı ancak okunamadı. Lütfen listeyi yenileyin.'
          );
        }
        mirrorDispatchLocally(updated);
        return { dispatch: updated, changed: true };
      }

      const current = await getDispatchByIdSupabase(id);
      if (!current) throw new DispatchDbError('DISPATCH_NOT_FOUND', 'Sefer bulunamadı.');
      if (current.status === 'in_transit') return { dispatch: current, changed: false };
      if (current.status === 'completed') {
        throw new DispatchDbError(
          'DISPATCH_ALREADY_COMPLETED',
          'Sefer kapatılmış. Yeniden açmadan şoför onayı verilemez.'
        );
      }
      throw new DispatchDbError('INVALID_DISPATCH_STATE', 'Sefer bu durumda onaylanamaz.');
    } catch (e: any) {
      console.error('[Supabase confirmDispatchAtomic]', e);
      if (e instanceof DispatchDbError) throw e;
      throw parseDispatchOperationError(e, 'confirm_dispatch');
    }
  } else if (pgPool) {
    try {
      const res = await pgPool.query(
        `UPDATE public.dispatches
            SET status = 'in_transit', driver_confirmed_at = $2
          WHERE id = $1 AND status = 'pending_confirmation'
          RETURNING id`,
        [id, now]
      );
      const current = await readDispatchById(id);
      if (!current) throw new DispatchDbError('DISPATCH_NOT_FOUND', 'Sefer bulunamadı.');
      if (res.rowCount && res.rowCount > 0) {
        mirrorDispatchLocally(current);
        return { dispatch: current, changed: true };
      }
      if (current.status === 'in_transit') return { dispatch: current, changed: false };
      if (current.status === 'completed') {
        throw new DispatchDbError(
          'DISPATCH_ALREADY_COMPLETED',
          'Sefer kapatılmış. Yeniden açmadan şoför onayı verilemez.'
        );
      }
      throw new DispatchDbError('INVALID_DISPATCH_STATE', 'Sefer bu durumda onaylanamaz.');
    } catch (e: any) {
      console.error('[Postgres confirmDispatchAtomic]', e);
      if (e instanceof DispatchDbError) throw e;
      throw parseDispatchOperationError(e, 'confirm_dispatch');
    }
  }

  const db = loadLocalDatabase();
  const idx = db.dispatches.findIndex((d) => d.id === id);
  if (idx === -1) throw new DispatchDbError('DISPATCH_NOT_FOUND', 'Sefer bulunamadı.');
  const current = db.dispatches[idx];
  if (current.status === 'completed') {
    throw new DispatchDbError(
      'DISPATCH_ALREADY_COMPLETED',
      'Sefer kapatılmış. Yeniden açmadan şoför onayı verilemez.'
    );
  }
  if (current.status === 'in_transit') return { dispatch: current, changed: false };
  if (current.status !== 'pending_confirmation') {
    throw new DispatchDbError('INVALID_DISPATCH_STATE', 'Sefer bu durumda onaylanamaz.');
  }
  db.dispatches[idx] = { ...current, status: 'in_transit', driverConfirmedAt: now };
  saveLocalDatabase(db);
  return { dispatch: db.dispatches[idx], changed: true };
}

// Yükleme kalemlerini yalnızca pending_confirmation durumunda, kilit altında
// değiştirir. Genel updateDispatch yolu durum/mutabakat yazımı için kullanılmaz.
export async function updateDispatchLoading(
  id: string,
  loadedItems: LoadedItem[],
  actor: { id: string; name: string }
): Promise<Dispatch> {
  const payload = {
    dispatch_id: id,
    changed_by_user_id: actor.id,
    changed_by_user_name: actor.name,
    loaded_items: (loadedItems || []).map((it) => ({
      product_id: it.productId,
      quantity: it.quantity,
    })),
  };

  if (isSupabaseOperational() && supabase) {
    try {
      const { error } = await supabase.rpc('update_dispatch_loading', { p: payload });
      if (error) throw error;
      const updated = await getDispatchByIdSupabase(id);
      if (!updated) {
        throw new DispatchDbError('DB_ERROR', 'Yükleme güncellendi ancak okunamadı.');
      }
      mirrorDispatchLocally(updated);
      return updated;
    } catch (e: any) {
      console.error('[Supabase updateDispatchLoading]', e);
      if (e instanceof DispatchDbError) throw e;
      throw parseDispatchOperationError(e, 'update_dispatch_loading');
    }
  } else if (pgPool) {
    try {
      await pgPool.query('SELECT public.update_dispatch_loading($1::jsonb)', [
        JSON.stringify(payload),
      ]);
      const updated = await readDispatchById(id);
      if (!updated) {
        throw new DispatchDbError('DB_ERROR', 'Yükleme güncellendi ancak okunamadı.');
      }
      mirrorDispatchLocally(updated);
      return updated;
    } catch (e: any) {
      console.error('[Postgres updateDispatchLoading]', e);
      if (e instanceof DispatchDbError) throw e;
      throw parseDispatchOperationError(e, 'update_dispatch_loading');
    }
  }

  const db = loadLocalDatabase();
  const idx = db.dispatches.findIndex((d) => d.id === id);
  if (idx === -1) throw new DispatchDbError('DISPATCH_NOT_FOUND', 'Sefer bulunamadı.');
  if (db.dispatches[idx].status === 'completed') {
    throw new DispatchDbError(
      'DISPATCH_ALREADY_COMPLETED',
      'Kapatılmış sefer değiştirilemez. Yönetici seferi yeniden açmalıdır.'
    );
  }
  if (db.dispatches[idx].status !== 'pending_confirmation') {
    throw new DispatchDbError(
      'INVALID_DISPATCH_STATE',
      'Yükleme kalemleri yalnızca şoför onayından önce değiştirilebilir.'
    );
  }
  if (db.deliveries.some((d) => d.dispatchId === id)) {
    throw new DispatchDbError(
      'INVALID_DISPATCH_STATE',
      'Teslimat başladıktan sonra yükleme listesi değiştirilemez.'
    );
  }

  const previousItems = db.dispatches[idx].loadedItems || [];
  db.dispatches[idx] = { ...db.dispatches[idx], loadedItems: loadedItems || [] };
  if (!Array.isArray(db.loadingAudit)) db.loadingAudit = [];
  db.loadingAudit.push({
    dispatchId: id,
    changedByUserId: actor.id,
    changedByUserName: actor.name,
    previousItems,
    newItems: loadedItems || [],
    changedAt: new Date().toISOString(),
  });
  saveLocalDatabase(db);
  return db.dispatches[idx];
}

export interface CloseDispatchInput {
  remainingFullCounted?: Record<string, number>;
  collectedEmptyDamacana?: number;
  collectedEmptyCamDamacana?: number;
  collectedEmptyTup?: number;
  actualCashInPocket?: number;
  actualPosSlipsTotal?: number;
  notes?: string;
}

// Gün sonu kapatma: toplamlar ve mutabakat kalemleri DB içinde, tek
// transaction'da ve sefer satırı kilitliyken hesaplanır. İstemciden gelen
// toplamlar/kapatan kullanıcı bilgisi GÜVENİLMEZ; yalnızca sayılan miktarlar
// ve sayısal mutabakat girdileri kabul edilir.
export async function closeDispatchAtomic(
  dispatchId: string,
  input: CloseDispatchInput,
  closedByUserId: string,
  closedByUserName: string
): Promise<Dispatch> {
  const remainingFullCounted = sanitizeQuantityMap(input.remainingFullCounted);
  const payload = {
    dispatch_id: dispatchId,
    closed_by_user_id: closedByUserId,
    closed_by_user_name: closedByUserName,
    remaining_full_counted: remainingFullCounted,
    collected_empty_damacana: Math.max(0, Math.floor(Number(input.collectedEmptyDamacana) || 0)),
    collected_empty_cam_damacana: Math.max(
      0,
      Math.floor(Number(input.collectedEmptyCamDamacana) || 0)
    ),
    collected_empty_tup: Math.max(0, Math.floor(Number(input.collectedEmptyTup) || 0)),
    actual_cash_in_pocket: sanitizeMoney(input.actualCashInPocket),
    actual_pos_slips_total: sanitizeMoney(input.actualPosSlipsTotal),
    notes: typeof input.notes === 'string' ? input.notes.slice(0, 2000) : '',
  };

  if (isSupabaseOperational() && supabase) {
    try {
      const { error } = await supabase.rpc('close_dispatch', { p: payload });
      if (error) throw error;
      const updated = await getDispatchByIdSupabase(dispatchId);
      if (!updated) {
        throw new DispatchDbError('DB_ERROR', 'Sefer kapatıldı ancak okunamadı.');
      }
      // Kapatan kullanıcı DB'de kalıcıdır; istemci gövdesinden gelen değer yok sayılır.
      mirrorDispatchLocally(updated);
      return updated;
    } catch (e: any) {
      console.error('[Supabase closeDispatchAtomic]', e);
      if (e instanceof DispatchDbError) throw e;
      throw parseDispatchOperationError(e, 'close_dispatch');
    }
  } else if (pgPool) {
    try {
      await pgPool.query('SELECT public.close_dispatch($1::jsonb)', [JSON.stringify(payload)]);
      const updated = await readDispatchById(dispatchId);
      if (!updated) {
        throw new DispatchDbError('DB_ERROR', 'Sefer kapatıldı ancak okunamadı.');
      }
      mirrorDispatchLocally(updated);
      return updated;
    } catch (e: any) {
      console.error('[Postgres closeDispatchAtomic]', e);
      if (e instanceof DispatchDbError) throw e;
      throw parseDispatchOperationError(e, 'close_dispatch');
    }
  }

  const db = loadLocalDatabase();
  const idx = db.dispatches.findIndex((d) => d.id === dispatchId);
  if (idx === -1) throw new DispatchDbError('DISPATCH_NOT_FOUND', 'Sefer bulunamadı.');
  const dispatch = db.dispatches[idx];
  if (dispatch.status === 'completed') {
    throw new DispatchDbError(
      'DISPATCH_ALREADY_COMPLETED',
      'Sefer zaten kapatılmış. Değişiklik için yönetici seferi yeniden açmalıdır.'
    );
  }
  if (dispatch.status !== 'in_transit') {
    throw new DispatchDbError(
      'INVALID_DISPATCH_STATE',
      'Şoför onayı verilmeden sefer kapatılamaz. Önce dağıtımı başlatın.'
    );
  }

  const deliveries = db.deliveries.filter((d) => d.dispatchId === dispatch.id);
  const deliveredTotals: Record<string, number> = {};
  let totalDeliveredValue = 0;
  let totalCashCollected = 0;
  let totalPosCollected = 0;
  let totalCreditAdded = 0;

  for (const del of deliveries) {
    totalDeliveredValue += Number(del.deliveredGrandTotal) || 0;
    totalCashCollected += Number(del.collectedPayment?.cashAmount) || 0;
    totalPosCollected += Number(del.collectedPayment?.posAmount) || 0;
    const diff = Number(del.collectedPayment?.diffUncollected) || 0;
    const customer = db.customers.find((c) => c.id === del.customerId);
    if (customer?.isAccountCustomer && diff > 0) totalCreditAdded += diff;
    for (const item of del.deliveredItems || []) {
      deliveredTotals[item.productId] = (deliveredTotals[item.productId] || 0) + item.quantity;
    }
  }

  const remainingFullExpected: Record<string, number> = {};
  for (const loaded of dispatch.loadedItems || []) {
    const delivered = deliveredTotals[loaded.productId] || 0;
    remainingFullExpected[loaded.productId] = Math.max(0, loaded.quantity - delivered);
  }

  const recon: EndOfDayReconciliation = {
    closedAt: new Date().toISOString(),
    closedByUserId,
    closedByUserName,
    remainingFullCounted,
    remainingFullExpected,
    collectedEmptyDamacana: payload.collected_empty_damacana,
    collectedEmptyCamDamacana: payload.collected_empty_cam_damacana,
    collectedEmptyTup: payload.collected_empty_tup,
    actualCashInPocket: payload.actual_cash_in_pocket,
    actualPosSlipsTotal: payload.actual_pos_slips_total,
    totalDeliveredValue,
    totalCashCollected,
    totalPosCollected,
    totalCreditAdded,
    notes: payload.notes,
  };

  db.dispatches[idx] = { ...dispatch, status: 'completed', endOfDayReconciliation: recon };
  saveLocalDatabase(db);
  return db.dispatches[idx];
}

export interface ExpectedCustomerSnapshot {
  balance?: number;
  empty?: {
    damacana: number;
    camDamacana?: number;
    tup: number;
  };
}

// Mutlak bakiye/boş kap yazımı. Çağıranın gördüğü değer hâlâ güncel değilse
// yazım reddedilir; böylece eşzamanlı teslimatların oluşturduğu değişiklik
// sessizce ezilmez.
export async function adminUpdateCustomerAtomic(
  id: string,
  updates: Partial<Customer>,
  expected: ExpectedCustomerSnapshot,
  actor: { id: string; name: string },
  reason?: string
): Promise<Customer | null> {
  const payload: any = {
    customer_id: id,
    changed_by_user_id: actor.id,
    changed_by_user_name: actor.name,
    reason: typeof reason === 'string' ? reason.slice(0, 500) : '',
  };
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.phone !== undefined) payload.phone = updates.phone;
  if (updates.address !== undefined) payload.address = updates.address;
  if (updates.emails !== undefined) payload.emails = updates.emails;
  if (updates.isAccountCustomer !== undefined) {
    payload.is_account_customer = updates.isAccountCustomer;
  }
  if (updates.notes !== undefined) payload.notes = updates.notes;

  if (updates.currentBalanceTL !== undefined) {
    payload.new_balance = Number(updates.currentBalanceTL) || 0;
    payload.expected_balance = Number(expected.balance);
  }

  if (updates.emptyDepositBalance !== undefined) {
    const empty: any = updates.emptyDepositBalance || {};
    const expectedEmpty: any = expected.empty || {};
    payload.new_empty = {
      damacana: Math.max(0, Math.floor(Number(empty.damacana) || 0)),
      cam_damacana: Math.max(
        0,
        Math.floor(Number(empty.camDamacana ?? empty.cam_damacana) || 0)
      ),
      tup: Math.max(0, Math.floor(Number(empty.tup) || 0)),
    };
    payload.expected_empty = {
      damacana: Math.max(0, Math.floor(Number(expectedEmpty.damacana) || 0)),
      cam_damacana: Math.max(
        0,
        Math.floor(Number(expectedEmpty.camDamacana ?? expectedEmpty.cam_damacana) || 0)
      ),
      tup: Math.max(0, Math.floor(Number(expectedEmpty.tup) || 0)),
    };
  }

  const handleRpcResult = (data: any) => {
    if (data?.conflict) {
      if (data.code === 'EMPTY_CONFLICT') {
        throw new DispatchDbError(
          'EMPTY_CONFLICT',
          'Boş kap bakiyesi bu sırada değişti. Sayfayı yenileyip tekrar deneyin.',
          data
        );
      }
      throw new DispatchDbError(
        'BALANCE_CONFLICT',
        'Müşteri bakiyesi bu sırada değişti. Sayfayı yenileyip tekrar deneyin.',
        data
      );
    }
  };

  if (isSupabaseOperational() && supabase) {
    try {
      const { data, error } = await supabase.rpc('admin_update_customer', { p: payload });
      if (error) throw error;
      handleRpcResult(data);
      const all = await getCustomers();
      return all.find((c) => c.id === id) || null;
    } catch (e: any) {
      console.error('[Supabase adminUpdateCustomerAtomic]', e);
      if (e instanceof DispatchDbError) throw e;
      throw parseDispatchOperationError(e, 'admin_update_customer');
    }
  } else if (pgPool) {
    try {
      const res = await pgPool.query('SELECT public.admin_update_customer($1::jsonb) AS result', [
        JSON.stringify(payload),
      ]);
      handleRpcResult(res.rows[0]?.result);
      const all = await getCustomers();
      return all.find((c) => c.id === id) || null;
    } catch (e: any) {
      console.error('[Postgres adminUpdateCustomerAtomic]', e);
      if (e instanceof DispatchDbError) throw e;
      throw parseDispatchOperationError(e, 'admin_update_customer');
    }
  }

  const db = loadLocalDatabase();
  const idx = db.customers.findIndex((c) => c.id === id);
  if (idx === -1) throw new DispatchDbError('CUSTOMER_NOT_FOUND', 'Müşteri bulunamadı.');
  const current = db.customers[idx];

  if (updates.currentBalanceTL !== undefined) {
    const expectedBalance = Number(expected.balance);
    if (!Number.isFinite(expectedBalance)) {
      throw new DispatchDbError(
        'EXPECTATION_REQUIRED',
        'Bakiye güncellemesi için beklenen güncel değer zorunludur.'
      );
    }
    const currentBalance = Number(current.currentBalanceTL) || 0;
    if (Math.abs(currentBalance - expectedBalance) > 0.005) {
      throw new DispatchDbError(
        'BALANCE_CONFLICT',
        'Müşteri bakiyesi bu sırada değişti. Sayfayı yenileyip tekrar deneyin.'
      );
    }
  }

  if (updates.emptyDepositBalance !== undefined) {
    const expectedEmpty: any = expected.empty;
    if (!expectedEmpty) {
      throw new DispatchDbError(
        'EXPECTATION_REQUIRED',
        'Boş kap güncellemesi için beklenen güncel değer zorunludur.'
      );
    }
    const currentEmpty = current.emptyDepositBalance || { damacana: 0, camDamacana: 0, tup: 0 };
    const pairs: Array<[string, number, number]> = [
      ['damacana', Number(currentEmpty.damacana) || 0, Number(expectedEmpty.damacana) || 0],
      [
        'camDamacana',
        Number(currentEmpty.camDamacana ?? (currentEmpty as any).cam_damacana) || 0,
        Number(expectedEmpty.camDamacana ?? expectedEmpty.cam_damacana) || 0,
      ],
      ['tup', Number(currentEmpty.tup) || 0, Number(expectedEmpty.tup) || 0],
    ];
    for (const [, currentQty, expectedQty] of pairs) {
      if (currentQty !== expectedQty) {
        throw new DispatchDbError(
          'EMPTY_CONFLICT',
          'Boş kap bakiyesi bu sırada değişti. Sayfayı yenileyip tekrar deneyin.'
        );
      }
    }
  }

  const merged: Customer = {
    ...current,
    ...updates,
    emptyDepositBalance:
      updates.emptyDepositBalance !== undefined
        ? {
            damacana: Math.max(0, Math.floor(Number(updates.emptyDepositBalance.damacana) || 0)),
            camDamacana: Math.max(
              0,
              Math.floor(
                Number(
                  updates.emptyDepositBalance.camDamacana ??
                    (updates.emptyDepositBalance as any).cam_damacana
                ) || 0
              )
            ),
            tup: Math.max(0, Math.floor(Number(updates.emptyDepositBalance.tup) || 0)),
          }
        : current.emptyDepositBalance,
  };
  db.customers[idx] = merged;
  if (
    updates.currentBalanceTL !== undefined ||
    updates.emptyDepositBalance !== undefined
  ) {
    if (!Array.isArray(db.financialAudit)) db.financialAudit = [];
    db.financialAudit.push({
      customerId: id,
      changedByUserId: actor.id,
      changedByUserName: actor.name,
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : 'Yönetici düzeltmesi',
      previousBalance:
        updates.currentBalanceTL !== undefined
          ? Number(current.currentBalanceTL) || 0
          : null,
      newBalance:
        updates.currentBalanceTL !== undefined
          ? Number(merged.currentBalanceTL) || 0
          : null,
      previousEmpty: current.emptyDepositBalance || null,
      newEmpty: merged.emptyDepositBalance || null,
      changedAt: new Date().toISOString(),
    });
  }
  saveLocalDatabase(db);
  return merged;
}

function mirrorDispatchLocally(disp: Dispatch): void {
  const db = loadLocalDatabase();
  const idx = db.dispatches.findIndex((d) => d.id === disp.id);
  if (idx !== -1) db.dispatches[idx] = disp;
  else db.dispatches.push(disp);
  saveLocalDatabase(db);
}

export async function createDispatch(disp: Dispatch): Promise<Dispatch> {
  if (isSupabaseOperational() && supabase) {
    try {
      const { data, error } = await supabase
        .from('dispatches')
        .upsert(
          {
            id: disp.id,
            date: disp.date,
            driver_id: disp.driverId,
            driver_name: disp.driverName,
            vehicle_plate: disp.vehiclePlate,
            loaded_by_user_id: disp.loadedByUserId,
            loaded_by_user_name: disp.loadedByUserName,
            driver_confirmed_at: disp.driverConfirmedAt,
            status: disp.status,
          },
          { onConflict: 'id' }
        )
        .select()
        .single();

      // Hata sessizce yutulmaz; yerel JSON'a düşülmez (çift kayıt/yanlış başarı engellenir).
      if (error || !data) {
        console.error('[Supabase createDispatch]', error);
        throw new Error(
          toDispatchDbError(error, 'Araç yükleme seferi kaydedilemedi. Lütfen tekrar deneyin.')
        );
      }

      if (disp.endOfDayReconciliation) {
        const reconPatch = dispatchReconScalarPatch(disp.endOfDayReconciliation);
        const up = await supabase.from('dispatches').update(reconPatch).eq('id', disp.id);
        if (up.error) {
          console.error('[Supabase createDispatch recon]', up.error);
          throw new Error(toTurkishDbError(up.error, 'Sefer mutabakat bilgileri kaydedilemedi.'));
        }
      }

      await writeDispatchChildrenSupabase(disp.id, disp.loadedItems || [], disp.endOfDayReconciliation);

      const saved = (await getDispatchByIdSupabase(disp.id)) || disp;
      mirrorDispatchLocally(saved);
      return saved;
    } catch (e: any) {
      console.error('[Supabase createDispatch Exception]', e);
      if (e instanceof Error) throw e;
      throw new Error(
        toDispatchDbError(e, 'Araç yükleme seferi kaydedilemedi. Lütfen tekrar deneyin.')
      );
    }
  } else if (pgPool) {
    const pool = pgPool;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO public.dispatches (id, date, driver_id, driver_name, vehicle_plate, loaded_by_user_id, loaded_by_user_name, driver_confirmed_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           date = EXCLUDED.date,
           driver_id = EXCLUDED.driver_id,
           driver_name = EXCLUDED.driver_name,
           vehicle_plate = EXCLUDED.vehicle_plate,
           loaded_by_user_id = EXCLUDED.loaded_by_user_id,
           loaded_by_user_name = EXCLUDED.loaded_by_user_name,
           driver_confirmed_at = EXCLUDED.driver_confirmed_at,
           status = EXCLUDED.status;`,
        [
          disp.id,
          disp.date,
          disp.driverId,
          disp.driverName,
          disp.vehiclePlate,
          disp.loadedByUserId,
          disp.loadedByUserName,
          disp.driverConfirmedAt,
          disp.status,
        ]
      );
      await client.query('DELETE FROM public.dispatch_items WHERE dispatch_id = $1', [disp.id]);
      for (const it of disp.loadedItems || []) {
        await client.query(
          'INSERT INTO public.dispatch_items (dispatch_id, product_id, quantity) VALUES ($1, $2, $3)',
          [disp.id, it.productId, it.quantity]
        );
      }
      if (disp.endOfDayReconciliation) {
        await client.query(
          `UPDATE public.dispatches SET closed_at=$2, total_delivered_value=$3, total_cash_collected=$4,
             total_pos_collected=$5, total_credit_added=$6, actual_cash_in_pocket=$7, actual_pos_slips_total=$8,
             collected_empty_damacana=$9, collected_empty_cam_damacana=$10, collected_empty_tup=$11,
             reconciliation_notes=$12 WHERE id=$1`,
          [
            disp.id,
            disp.endOfDayReconciliation.closedAt,
            disp.endOfDayReconciliation.totalDeliveredValue,
            disp.endOfDayReconciliation.totalCashCollected,
            disp.endOfDayReconciliation.totalPosCollected,
            disp.endOfDayReconciliation.totalCreditAdded,
            disp.endOfDayReconciliation.actualCashInPocket,
            disp.endOfDayReconciliation.actualPosSlipsTotal,
            disp.endOfDayReconciliation.collectedEmptyDamacana,
            disp.endOfDayReconciliation.collectedEmptyCamDamacana || 0,
            disp.endOfDayReconciliation.collectedEmptyTup,
            disp.endOfDayReconciliation.notes || '',
          ]
        );
        await writeDispatchReconPg(client, disp.id, disp.endOfDayReconciliation);
      }
      await client.query('COMMIT');

      const saved = await readDispatchByIdPg(client, disp.id);
      if (saved) {
        mirrorDispatchLocally(saved);
        return saved;
      }
      mirrorDispatchLocally(disp);
      return disp;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[Postgres createDispatch]', e);
      throw e;
    } finally {
      client.release();
    }
  }

  mirrorDispatchLocally(disp);
  return disp;
}

export async function updateDispatch(id: string, updates: Partial<Dispatch>): Promise<Dispatch | null> {
  // Durum ve mutabakat yalnızca doğrulanmış atomik uçlardan değiştirilebilir.
  // Bu genel fonksiyon gelecekte bir HTTP ucuna bağlanırsa sefer yeniden
  // açma/kapatma kurallarını atlayamaz.
  if (updates.status !== undefined || updates.endOfDayReconciliation !== undefined) {
    throw new DispatchDbError(
      'VALIDATION_ERROR',
      'Sefer durumu ve mutabakatı yalnızca atomik onay/kapatma uçlarından değiştirilebilir.'
    );
  }

  if (isSupabaseOperational() && supabase) {
    try {
      const payload: any = {};
      if (updates.status !== undefined) payload.status = updates.status;
      if (updates.driverConfirmedAt !== undefined) payload.driver_confirmed_at = updates.driverConfirmedAt;
      if (updates.endOfDayReconciliation !== undefined) {
        Object.assign(payload, dispatchReconScalarPatch(updates.endOfDayReconciliation));
      }

      if (Object.keys(payload).length > 0) {
        const { error } = await supabase.from('dispatches').update(payload).eq('id', id);
        if (error) {
          console.error('[Supabase updateDispatch]', error);
          throw new Error(toDispatchDbError(error, 'Sefer güncellenemedi. Lütfen tekrar deneyin.'));
        }
      }

      if (updates.loadedItems !== undefined || updates.endOfDayReconciliation !== undefined) {
        await writeDispatchChildrenSupabase(id, updates.loadedItems, updates.endOfDayReconciliation);
      }

      const updated = await getDispatchByIdSupabase(id);
      if (!updated) return null;
      mirrorDispatchLocally(updated);
      return updated;
    } catch (e: any) {
      console.error('[Supabase updateDispatch Exception]', e);
      if (e instanceof Error) throw e;
      throw new Error(toDispatchDbError(e, 'Sefer güncellenemedi. Lütfen tekrar deneyin.'));
    }
  } else if (pgPool) {
    const pool = pgPool;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sets: string[] = [];
      const values: any[] = [];
      let i = 1;
      if (updates.status !== undefined) {
        sets.push(`status = $${i++}`);
        values.push(updates.status);
      }
      if (updates.driverConfirmedAt !== undefined) {
        sets.push(`driver_confirmed_at = $${i++}`);
        values.push(updates.driverConfirmedAt);
      }
      if (updates.endOfDayReconciliation !== undefined) {
        const patch = dispatchReconScalarPatch(updates.endOfDayReconciliation);
        for (const [col, val] of Object.entries(patch)) {
          sets.push(`${col} = $${i++}`);
          values.push(val);
        }
      }
      if (sets.length > 0) {
        values.push(id);
        await client.query(`UPDATE public.dispatches SET ${sets.join(', ')} WHERE id = $${i};`, values);
      }
      if (updates.loadedItems !== undefined) {
        await client.query('DELETE FROM public.dispatch_items WHERE dispatch_id = $1', [id]);
        for (const it of updates.loadedItems || []) {
          await client.query(
            'INSERT INTO public.dispatch_items (dispatch_id, product_id, quantity) VALUES ($1, $2, $3)',
            [id, it.productId, it.quantity]
          );
        }
      }
      if (updates.endOfDayReconciliation !== undefined) {
        await writeDispatchReconPg(client, id, updates.endOfDayReconciliation);
      }
      await client.query('COMMIT');

      const updated = await readDispatchByIdPg(client, id);
      if (updated) {
        mirrorDispatchLocally(updated);
        return updated;
      }
      return null;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[Postgres updateDispatch]', e);
      // Hata null'a çevrilmez; çağırana bildirilir (404 yanıltıcı olurdu).
      throw e;
    } finally {
      client.release();
    }
  }

  const db = loadLocalDatabase();
  const idx = db.dispatches.findIndex((d) => d.id === id);
  if (idx === -1) return null;
  db.dispatches[idx] = { ...db.dispatches[idx], ...updates };
  saveLocalDatabase(db);
  return db.dispatches[idx];
}

// 5. Deliveries
export async function getDeliveries(params?: { dispatchId?: string; driverId?: string; date?: string }): Promise<Delivery[]> {
  if (isSupabaseOperational() && supabase) {
    try {
      let query = supabase.from('deliveries').select('*').order('timestamp', { ascending: false });
      if (params?.dispatchId) query = query.eq('dispatch_id', params.dispatchId);
      if (params?.driverId) query = query.eq('driver_id', params.driverId);
      if (params?.date) {
        // Gün filtresi sunucu tarafında dar bir aralığa indirilir; kesin gün
        // eşleşmesi aşağıda bellekte doğrulanır. Böylece tüm geçmiş çekilmez
        // ve idx_deliveries_timestamp indeksi kullanılabilir.
        const window = utcDayQueryWindow(params.date);
        if (window) {
          query = query.gte('timestamp', window.lower).lt('timestamp', window.upper);
        }
      }
      const { data, error } = await query;
      if (!error && data) {
        const ids = data.map((d: any) => d.id);
        const [items, containers] = await Promise.all([
          fetchInChunks(
            ids,
            (batch) =>
              supabase!
                .from('delivery_items')
                .select('delivery_id, line_no, product_id, product_name, quantity, unit_price, line_total')
                .in('delivery_id', batch),
            '[Supabase getDeliveries items]'
          ),
          fetchInChunks(
            ids,
            (batch) =>
              supabase!
                .from('delivery_container_returns')
                .select('delivery_id, deposit_type, received_qty, diff_qty')
                .in('delivery_id', batch),
            '[Supabase getDeliveries containers]'
          ),
        ]);
        const itemsByDelivery = groupRows(items, (i: any) => i.delivery_id);
        const containersByDelivery = groupRows(containers, (c: any) => c.delivery_id);
        let list = data.map((row: any) =>
          mapDeliveryFromDb(
            row,
            itemsByDelivery.get(row.id) || [],
            containersByDelivery.get(row.id) || []
          )
        );
        if (params?.date) {
          list = list.filter((d) => isSameUtcDate(d.timestamp, params.date!));
        }
        return list;
      }
      console.error('[Supabase getDeliveries]', error);
    } catch (e) {
      console.error('[Supabase getDeliveries Exception]', e);
    }
  }

  let list = [...loadLocalDatabase().deliveries];
  if (params?.dispatchId) list = list.filter((d) => d.dispatchId === params.dispatchId);
  if (params?.driverId) list = list.filter((d) => d.driverId === params.driverId);
  if (params?.date) list = list.filter((d) => isSameUtcDate(d.timestamp, params.date!));
  list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return list;
}

// Tek bir teslimatı satırları ve boş kap hareketleriyle okur.
async function getDeliveryByIdSupabase(id: string): Promise<Delivery | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('deliveries').select('*').eq('id', id).maybeSingle();
  if (error || !data) {
    if (error) console.error('[Supabase getDeliveryById]', error);
    return null;
  }
  const [iRes, cRes] = await Promise.all([
    supabase
      .from('delivery_items')
      .select('delivery_id, line_no, product_id, product_name, quantity, unit_price, line_total')
      .eq('delivery_id', id),
    supabase
      .from('delivery_container_returns')
      .select('delivery_id, deposit_type, received_qty, diff_qty')
      .eq('delivery_id', id),
  ]);
  return mapDeliveryFromDb(data, iRes.data || [], cRes.data || []);
}

// Teslimatı kimliğine göre okur. Tekrarlanan (retry) isteklerde çift kayıt
// oluşmasını engellemek için sunucu tarafı ön kontrolünde kullanılır.
// Arka uç yapılandırılmışsa sorgu hatası "yok" sayılmaz; hata fırlatılır.
export async function getDeliveryById(id: string): Promise<Delivery | null> {
  if (!id) return null;

  if (isSupabaseOperational() && supabase) {
    const exists = await supabase.from('deliveries').select('id').eq('id', id).maybeSingle();
    if (exists.error) {
      console.error('[Supabase getDeliveryById exists]', exists.error);
      throw new Error(toTurkishDbError(exists.error, 'Teslimat sorgulanamadı. Lütfen tekrar deneyin.'));
    }
    if (!exists.data) return null;
    const full = await getDeliveryByIdSupabase(id);
    if (!full) {
      throw new Error('Teslimat okunamadı. Lütfen tekrar deneyin.');
    }
    return full;
  }

  if (pgPool) {
    const row = await pgPool.query('SELECT * FROM public.deliveries WHERE id = $1', [id]);
    if (!row.rows[0]) return null;
    const [items, containers] = await Promise.all([
      pgPool.query(
        'SELECT delivery_id, line_no, product_id, product_name, quantity, unit_price, line_total FROM public.delivery_items WHERE delivery_id = $1',
        [id]
      ),
      pgPool.query(
        'SELECT delivery_id, deposit_type, received_qty, diff_qty FROM public.delivery_container_returns WHERE delivery_id = $1',
        [id]
      ),
    ]);
    return mapDeliveryFromDb(row.rows[0], items.rows, containers.rows);
  }

  return loadLocalDatabase().deliveries.find((d) => d.id === id) || null;
}

// Teslimatı ve müşteriyi yerel JSON yedeğine yansıtır (tutarlılık için).
function mirrorDeliveryLocally(del: Delivery, updatedCustomer: Customer): void {
  const db = loadLocalDatabase();
  const existing = db.deliveries.findIndex((d) => d.id === del.id);
  if (existing !== -1) db.deliveries[existing] = del;
  else db.deliveries.unshift(del);
  const cIdx = db.customers.findIndex((c) => c.id === updatedCustomer.id);
  if (cIdx !== -1) db.customers[cIdx] = updatedCustomer;
  saveLocalDatabase(db);
}

// Teslimat RPC'sinden dönen hata kodlarını taşıyan hata sınıfı.
// Sunucu katmanı bu kodu HTTP 409/422 gibi yanıtlara eşler.
export class DeliveryDbError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DeliveryDbError';
    this.code = code;
  }
}

// Sefer durum geçişleri ve mutlak müşteri yazımları için hata sınıfı.
// Sunucu katmanı `code` alanını HTTP 400/403/409/503 yanıtlarına eşler.
export class DispatchDbError extends Error {
  code: string;
  details?: any;

  constructor(code: string, message: string, details?: any) {
    super(message);
    this.name = 'DispatchDbError';
    this.code = code;
    this.details = details;
  }
}

// Sunucu tarafındaki tüm yazma işlemleri için güvenlik kapısı.
// Supabase yalnızca hizmet rolü anahtarıyla ve anon/authenticated RPC
// erişimi kapatılmışsa kullanılabilir. Aksi halde işlem sessizce yerel
// moda düşmez; 503 ile fail-closed davranır.
export async function assertRpcAuthorizationReady(): Promise<void> {
  if (isSupabaseOperational() && supabase) {
    if (!isPrivilegedSupabaseKey(rawSupabaseKey)) {
      throw new DispatchDbError('RPC_AUTH_REQUIRED', RPC_AUTH_UNAVAILABLE_MESSAGE);
    }
    try {
      const { data, error } = await supabase.rpc('rpc_authorization_ready');
      if (error) throw error;
      if (data !== true) {
        throw new DispatchDbError('RPC_AUTH_REQUIRED', RPC_HARDENING_MISSING_MESSAGE);
      }
      return;
    } catch (e: any) {
      if (e instanceof DispatchDbError) throw e;
      if (hasRpcMissingSignature(e)) {
        throw new DispatchDbError('MIGRATION_REQUIRED', RPC_HARDENING_MISSING_MESSAGE);
      }
      throw new DispatchDbError('RPC_AUTH_REQUIRED', RPC_HARDENING_MISSING_MESSAGE);
    }
  }

  if (pgPool) {
    try {
      const result = await pgPool.query('SELECT public.rpc_authorization_ready() AS ready');
      if (result.rows[0]?.ready !== true) {
        throw new DispatchDbError('RPC_AUTH_REQUIRED', RPC_HARDENING_MISSING_MESSAGE);
      }
      return;
    } catch (e: any) {
      if (e instanceof DispatchDbError) throw e;
      if (hasRpcMissingSignature(e)) {
        throw new DispatchDbError('MIGRATION_REQUIRED', RPC_HARDENING_MISSING_MESSAGE);
      }
      throw new DispatchDbError('RPC_AUTH_REQUIRED', RPC_HARDENING_MISSING_MESSAGE);
    }
  }

  // Yerel JSON modunda veritabanı RPC güvenlik kapısı gerekmez.
}

function hasRpcMissingSignature(e: any): boolean {
  const raw = `${e?.message || ''} ${e?.details || ''} ${e?.hint || ''}`;
  return String(e?.code || '') === '42883' || /could not find the function|function .* does not exist/i.test(raw);
}

function parseDeliveryDbError(e: any): DeliveryDbError {
  const raw = `${e?.message || ''} ${e?.details || ''} ${e?.hint || ''}`.trim();

  if (/DISPATCH_CLOSED/.test(raw)) {
    return new DeliveryDbError(
      'DISPATCH_CLOSED',
      'Sefer kapatılmış. Geç teslimat için yönetici seferi yeniden açmalıdır.'
    );
  }
  if (/CUSTOMER_NOT_FOUND/.test(raw)) {
    return new DeliveryDbError('CUSTOMER_NOT_FOUND', 'Müşteri bulunamadı.');
  }
  if (/DISPATCH_NOT_FOUND/.test(raw)) {
    return new DeliveryDbError('DISPATCH_NOT_FOUND', 'Sefer bulunamadı.');
  }
  if (/EMPTY_BALANCE_NEGATIVE/.test(raw)) {
    return new DeliveryDbError(
      'EMPTY_BALANCE_NEGATIVE',
      'Boş kap bakiyesi negatife düşeceği için işlem reddedildi. Lütfen miktarları kontrol edin.'
    );
  }
  if (/INSUFFICIENT_VEHICLE_STOCK/.test(raw)) {
    return new DeliveryDbError(
      'INSUFFICIENT_VEHICLE_STOCK',
      'Araçta bu üründen yeterli stok yok. Teslimat miktarı yüklenen miktarı aşamaz.'
    );
  }
  if (/PAYMENT_DATA_INCONSISTENT/.test(raw)) {
    return new DeliveryDbError(
      'PAYMENT_DATA_INCONSISTENT',
      'Teslimat ödeme tutarları birbiriyle uyuşmuyor. Kayıt reddedildi.'
    );
  }
  if (/VALIDATION_ERROR/.test(raw)) {
    return new DeliveryDbError('VALIDATION_ERROR', 'Teslimat bilgileri geçersiz.');
  }
  if (hasRpcMissingSignature(e)) {
    return new DeliveryDbError(
      'MIGRATION_REQUIRED',
      'Sunucu veritabanı güncellemesi eksik: apply_delivery fonksiyonu bulunamadı. Yöneticiye bildirin.'
    );
  }

  return new DeliveryDbError(
    'DB_ERROR',
    toTurkishDbError(e, 'Teslimat veritabanına kaydedilemedi. Lütfen tekrar deneyin.')
  );
}

// RPC'ye gönderilecek delta tabanlı yük. Mutlak bakiye GÖNDERİLMEZ;
// böylece eşzamanlı işlemlerde kayıp güncelleme (lost update) oluşmaz.
function buildApplyDeliveryPayload(del: Delivery): Record<string, any> {
  const items = (del.deliveredItems || []).map((it, idx) => ({
    line_no: idx + 1,
    product_id: it.productId,
    product_name: it.productName,
    quantity: Number(it.quantity) || 0,
    unit_price: Number(it.unitPrice) || 0,
    line_total: Number(it.lineTotal) || 0,
  }));

  const recv: any = del.emptyContainersReceived || {};
  const diff: any = del.emptyContainersDiff || {};
  const containerReturns = DEPOSIT_BUCKETS.map((b) => {
    let rv: any = recv[b.key];
    let dv: any = diff[b.key];
    if (b.key === 'camDamacana') {
      if (rv === undefined) rv = recv.cam_damacana;
      if (dv === undefined) dv = diff.cam_damacana;
    }
    return {
      deposit_type: b.depositType,
      received_qty: Number(rv) || 0,
      diff_qty: Number(dv) || 0,
    };
  });

  const emptyDeltas: Record<string, number> = {};
  for (const row of containerReturns) {
    emptyDeltas[row.deposit_type] = row.diff_qty;
  }

  return {
    id: del.id,
    dispatch_id: del.dispatchId,
    driver_id: del.driverId,
    driver_name: del.driverName,
    vehicle_plate: del.vehiclePlate,
    customer_id: del.customerId,
    customer_name: del.customerName,
    customer_address: del.customerAddress,
    customer_phone: del.customerPhone,
    timestamp: del.timestamp,
    delivered_grand_total: Number(del.deliveredGrandTotal) || 0,
    payment_method: del.collectedPayment?.method || 'UNPAID',
    cash_amount: Number(del.collectedPayment?.cashAmount) || 0,
    pos_amount: Number(del.collectedPayment?.posAmount) || 0,
    total_collected: Number(del.collectedPayment?.totalCollected) || 0,
    diff_uncollected: Number(del.collectedPayment?.diffUncollected) || 0,
    payment_status: del.collectedPayment?.status || 'unpaid',
    notes: del.notes || '',
    is_offline_sync: !!del.isOfflineSync,
    items,
    container_returns: containerReturns,
    empty_deltas: emptyDeltas,
    prices: items
      .filter((i) => i.unit_price > 0)
      .map((i) => ({ product_id: i.product_id, unit_price: i.unit_price })),
  };
}

async function fetchCustomerAfterDelivery(customerId: string, fallback: Customer): Promise<Customer> {
  try {
    const all = await getCustomers();
    return all.find((c) => c.id === customerId) || fallback;
  } catch (e) {
    console.error('[createDeliveryRecord customer refresh]', e);
    return fallback;
  }
}

export async function createDeliveryRecord(
  del: Delivery,
  updatedCustomer: Customer
): Promise<{ delivery: Delivery; updatedCustomer: Customer; duplicate?: boolean }> {
  const payload = buildApplyDeliveryPayload(del);

  if (isSupabaseOperational() && supabase) {
    let duplicate = false;
    try {
      const { data, error } = await supabase.rpc('apply_delivery', { p: payload });
      if (error) throw error;
      duplicate = !!data?.duplicate;
    } catch (e: any) {
      console.error('[Supabase apply_delivery]', e);
      throw parseDeliveryDbError(e);
    }

    // RPC başarılıysa yazma zaten commit edilmiştir. Okuma başarısız olursa
    // istemciye 500 dönmek, aynı teslimatın yeni bir kimlikle tekrar
    // girilmesine ve çift borçlanmaya yol açabilir. Bu nedenle RPC'nin
    // onayladığı yük (duplicate=false) güvenilir kabul edilir.
    const savedDel = await getDeliveryById(del.id);
    if (!savedDel) {
      if (duplicate) {
        throw new DeliveryDbError(
          'DB_ERROR',
          'Teslimat zaten kayıtlı ancak doğrulanamadı. Lütfen listeyi yenileyin.'
        );
      }
      mirrorDeliveryLocally(del, updatedCustomer);
      return { delivery: del, updatedCustomer, duplicate: false };
    }
    const currentCustomer = await fetchCustomerAfterDelivery(del.customerId, updatedCustomer);
    mirrorDeliveryLocally(savedDel, currentCustomer);
    return { delivery: savedDel, updatedCustomer: currentCustomer, duplicate };
  } else if (pgPool) {
    let duplicate = false;
    try {
      const res = await pgPool.query('SELECT public.apply_delivery($1::jsonb) AS result', [
        JSON.stringify(payload),
      ]);
      duplicate = !!res.rows[0]?.result?.duplicate;
    } catch (e: any) {
      console.error('[Postgres apply_delivery]', e);
      throw parseDeliveryDbError(e);
    }

    const savedDel = await getDeliveryById(del.id);
    if (!savedDel) {
      if (duplicate) {
        throw new DeliveryDbError(
          'DB_ERROR',
          'Teslimat zaten kayıtlı ancak doğrulanamadı. Lütfen listeyi yenileyin.'
        );
      }
      mirrorDeliveryLocally(del, updatedCustomer);
      return { delivery: del, updatedCustomer, duplicate: false };
    }
    const currentCustomer = await fetchCustomerAfterDelivery(del.customerId, updatedCustomer);
    mirrorDeliveryLocally(savedDel, currentCustomer);
    return { delivery: savedDel, updatedCustomer: currentCustomer, duplicate };
  }

  // Local fallback (yalnızca Supabase/Postgres yapılandırılmadığında)
  const db = loadLocalDatabase();
  const dispatch = db.dispatches.find((d) => d.id === del.dispatchId);
  if (!dispatch) {
    throw new DeliveryDbError('DISPATCH_NOT_FOUND', 'Sefer bulunamadı.');
  }
  if (dispatch.status === 'completed') {
    throw new DeliveryDbError(
      'DISPATCH_CLOSED',
      'Sefer kapatılmış. Geç teslimat için yönetici seferi yeniden açmalıdır.'
    );
  }
  const existing = db.deliveries.find((d) => d.id === del.id);
  if (existing) {
    const currentCustomer = db.customers.find((c) => c.id === del.customerId) || updatedCustomer;
    return { delivery: existing, updatedCustomer: currentCustomer, duplicate: true };
  }

  const alreadyDelivered: Record<string, number> = {};
  for (const prior of db.deliveries.filter((d) => d.dispatchId === del.dispatchId)) {
    for (const item of prior.deliveredItems || []) {
      alreadyDelivered[item.productId] =
        (alreadyDelivered[item.productId] || 0) + (Number(item.quantity) || 0);
    }
  }
  for (const item of del.deliveredItems || []) {
    const loaded = dispatch.loadedItems.find((li) => li.productId === item.productId);
    const available =
      (Number(loaded?.quantity) || 0) - (alreadyDelivered[item.productId] || 0);
    if (Number(item.quantity) > available) {
      throw new DeliveryDbError(
        'INSUFFICIENT_VEHICLE_STOCK',
        'Araçta bu üründen yeterli stok yok. Teslimat miktarı yüklenen miktarı aşamaz.'
      );
    }
  }

  mirrorDeliveryLocally(del, updatedCustomer);
  return { delivery: del, updatedCustomer, duplicate: false };
}

// Yönetici tarafından kapatılmış seferi denetim kaydıyla yeniden açar.
// Asıl yetki sınırı sunucu katmanındaki requireAdmin'dir. DB fonksiyonu,
// çağıranın verdiği kullanıcı kimliğinin role='admin' olmasını kontrol eder;
// ancak bu kimlik DB oturumundan doğrulanmadığı için tek başına güvenilir
// değildir (bkz. migration güven sınırı notu).
export async function reopenDispatch(
  dispatchId: string,
  managerUserId: string,
  managerUserName: string,
  reason: string
): Promise<{ reopened: boolean; code?: string; dispatch: Dispatch | null }> {
  const payload = {
    dispatch_id: dispatchId,
    reopened_by_user_id: managerUserId,
    reopened_by_user_name: managerUserName,
    reason,
  };

  const parseReopenError = (e: any): DeliveryDbError => {
    const raw = `${e?.message || ''} ${e?.details || ''} ${e?.hint || ''}`.trim();
    if (/REASON_REQUIRED/.test(raw)) {
      return new DeliveryDbError('REASON_REQUIRED', 'Yeniden açma için geçerli bir gerekçe girin.');
    }
    if (/NOT_AUTHORIZED/.test(raw)) {
      return new DeliveryDbError('NOT_AUTHORIZED', 'Bu işlemi yalnızca yönetici yapabilir.');
    }
    if (/DISPATCH_NOT_FOUND/.test(raw)) {
      return new DeliveryDbError('DISPATCH_NOT_FOUND', 'Sefer bulunamadı.');
    }
    if (/HISTORICAL_REOPEN_BLOCKED/.test(raw)) {
      return new DeliveryDbError(
        'HISTORICAL_REOPEN_BLOCKED',
        'Kapanış zamanı doğrulanmamış eski sefer güvenli biçimde yeniden açılamaz.'
      );
    }
    if (/REOPEN_WRITE_NOT_APPLIED/.test(raw)) {
      return new DeliveryDbError(
        'WRITE_NOT_APPLIED',
        'Yeniden açma veritabanına uygulanmadı. Sistem yöneticisiyle iletişime geçin.'
      );
    }
    if (String(e?.code || '') === '23505') {
      return new DeliveryDbError(
        'ACTIVE_DISPATCH_CONFLICT',
        "Şoförün başka bir aktif seferi var. Yeniden açmadan önce onu kapatın."
      );
    }
    if (hasRpcMissingSignature(e)) {
      return new DeliveryDbError(
        'MIGRATION_REQUIRED',
        'Sunucu veritabanı güncellemesi eksik: reopen_dispatch fonksiyonu bulunamadı.'
      );
    }
    return new DeliveryDbError('DB_ERROR', 'Sefer yeniden açılamadı. Lütfen tekrar deneyin.');
  };

  if (isSupabaseOperational() && supabase) {
    let data: any;
    try {
      const rpc = await supabase.rpc('reopen_dispatch', { p: payload });
      if (rpc.error) throw rpc.error;
      data = rpc.data;
    } catch (e: any) {
      console.error('[Supabase reopen_dispatch]', e);
      throw parseReopenError(e);
    }

    const all = await getDispatches();
    return {
      reopened: !!data?.reopened,
      code: data?.code,
      dispatch: all.find((d) => d.id === dispatchId) || null,
    };
  }

  if (pgPool) {
    let data: any;
    try {
      const res = await pgPool.query('SELECT public.reopen_dispatch($1::jsonb) AS result', [
        JSON.stringify(payload),
      ]);
      data = res.rows[0]?.result;
    } catch (e: any) {
      console.error('[Postgres reopen_dispatch]', e);
      throw parseReopenError(e);
    }

    const all = await getDispatches();
    return {
      reopened: !!data?.reopened,
      code: data?.code,
      dispatch: all.find((d) => d.id === dispatchId) || null,
    };
  }

  const db = loadLocalDatabase();
  const manager = db.users.find((u) => u.id === managerUserId);
  if (!manager || manager.role !== 'admin') {
    throw new DeliveryDbError('NOT_AUTHORIZED', 'Bu işlemi yalnızca yönetici yapabilir.');
  }
  const idx = db.dispatches.findIndex((d) => d.id === dispatchId);
  if (idx === -1) {
    throw new DeliveryDbError('DISPATCH_NOT_FOUND', 'Sefer bulunamadı.');
  }
  const dispatch = db.dispatches[idx];
  if (dispatch.status !== 'completed') {
    return { reopened: false, code: 'NOT_COMPLETED', dispatch };
  }
  const previousReconciliation = dispatch.endOfDayReconciliation || null;
  if (!previousReconciliation?.closedAt) {
    throw new DeliveryDbError(
      'HISTORICAL_REOPEN_BLOCKED',
      'Kapanış zamanı doğrulanmamış eski sefer güvenli biçimde yeniden açılamaz.'
    );
  }
  const activeConflict = db.dispatches.some(
    (d) =>
      d.id !== dispatchId &&
      d.status !== 'completed' &&
      (d.driverId === dispatch.driverId || d.vehiclePlate === dispatch.vehiclePlate)
  );
  if (activeConflict) {
    throw new DeliveryDbError(
      'ACTIVE_DISPATCH_CONFLICT',
      'Şoförün veya aracın başka bir aktif seferi var. Yeniden açmadan önce onu kapatın.'
    );
  }

  if (!Array.isArray(db.reopenAudit)) db.reopenAudit = [];
  db.reopenAudit.push({
    dispatchId,
    reopenedByUserId: managerUserId,
    reopenedByUserName: managerUserName,
    reason,
    previousClosedAt: previousReconciliation.closedAt,
    previousReconciliation,
    reopenedAt: new Date().toISOString(),
  });

  db.dispatches[idx] = {
    ...dispatch,
    status: 'in_transit',
  };
  saveLocalDatabase(db);
  return { reopened: true, dispatch: db.dispatches[idx] };
}

// 6. Retention 60-Day Cleanup Routine (Every night at 23:00 and manual on-demand)
let inMemoryLastPurged = 0;
let inMemoryLastCleanupDate: string | null = null;

const RETENTION_STALE_MS = 3 * 24 * 60 * 60 * 1000;

export function getNext2300Time(): { nextDate: Date; msUntil: number; formatted: string } {
  const now = new Date();
  const target = new Date(now);
  target.setHours(23, 0, 0, 0);
  if (now.getTime() >= target.getTime()) {
    // If past 23:00 today, schedule for tomorrow 23:00
    target.setDate(target.getDate() + 1);
  }
  const msUntil = target.getTime() - now.getTime();
  const hours = Math.floor(msUntil / (1000 * 60 * 60));
  const minutes = Math.floor((msUntil % (1000 * 60 * 60)) / (1000 * 60));
  const formatted = `${target.toISOString().split('T')[0]} 23:00 (${hours} saat ${minutes} dk sonra)`;
  return { nextDate: target, msUntil, formatted };
}

// Bir hata oluştuğunda durum satırına yazılır. Purge fonksiyonu tek
// transaction olduğundan hata durumunda kendi durum güncellemesi geri alınır;
// bu nedenle hata ayrı bir ifade ile kalıcılaştırılır.
async function recordRetentionError(message: string): Promise<void> {
  if (isSupabaseOperational() && supabase) {
    await supabase
      .from('retention_state')
      .update({ last_error: message, last_finished_at: new Date().toISOString() })
      .eq('id', true);
  }
}

export async function getRetentionHealth(): Promise<RetentionHealth> {
  let state: any = null;
  if (isSupabaseOperational() && supabase) {
    const { data } = await supabase.from('retention_state').select('*').eq('id', true).maybeSingle();
    state = data || null;
  }
  const lastSuccessAt = state?.last_success_at || inMemoryLastCleanupDate || null;
  const stale = !lastSuccessAt || Date.now() - new Date(lastSuccessAt).getTime() > RETENTION_STALE_MS;
  return {
    lastSuccessAt,
    lastFinishedAt: state?.last_finished_at || null,
    lastDryRun: state?.last_dry_run ?? null,
    lastError: state?.last_error ?? null,
    lastThresholdDate: state?.last_threshold_date || null,
    retentionDays: Number(state?.retention_days) || RETENTION_DAYS,
    counts: state?.last_counts || null,
    stale,
  };
}

// 60 günlük temizlik. Varsayılan olarak DRY-RUN'dır; gerçek silme için
// RETENTION_DRY_RUN=false ayarlanmalıdır. Gerçek işlem sunucudaki
// public.purge_retention RPC'si ile tek transaction içinde, arşiv-önce
// mantığıyla ve advisory lock altında yürütülür.
export async function runRetentionCleanup(): Promise<RetentionRunResult> {
  const dryRun = process.env.RETENTION_DRY_RUN !== 'false';
  const nowIso = new Date().toISOString();
  const thresholdDateStr = retentionCutoffDate();
  const cutoffInstant = retentionCutoffInstant();

  const result: RetentionRunResult = {
    dryRun,
    thresholdDate: thresholdDateStr,
    retentionDays: RETENTION_DAYS,
    purgedDispatches: 0,
    purgedDeliveries: 0,
    archivedRows: 0,
    counts: null,
    locked: false,
    lastCleanupDate: nowIso,
  };

  let remoteCounts: any = null;
  let usedRemote = false;

  if (isSupabaseOperational() && supabase) {
    try {
      await supabase
        .from('retention_state')
        .update({ last_started_at: nowIso })
        .eq('id', true);

      // Sınırlı okuma: yalnızca eşikten eski seferler çekilir.
      const { data: rows, error } = await supabase
        .from('dispatches')
        .select('id, status, closed_at, date')
        .lt('date', thresholdDateStr);
      if (error) throw error;
      const dispatchIds = (rows || [])
        .filter(
          (r: any) =>
            r.status === 'completed' &&
            r.closed_at &&
            typeof r.date === 'string' &&
            r.date < thresholdDateStr
        )
        .map((r: any) => r.id);

      const { data: rpcData, error: rpcErr } = await supabase.rpc('purge_retention', {
        p_dry_run: dryRun,
        p_dispatch_ids: dispatchIds,
        p_delivery_ids: [],
        p_retention_days: RETENTION_DAYS,
      });
      if (rpcErr) throw rpcErr;

      remoteCounts = rpcData || null;
      usedRemote = true;
      result.counts = remoteCounts?.counts || null;
      result.purgedDispatches =
        Number(remoteCounts?.purged_dispatches ?? remoteCounts?.counts?.dispatches) || 0;
      result.purgedDeliveries =
        Number(remoteCounts?.purged_deliveries ?? remoteCounts?.counts?.deliveries) || 0;
      result.archivedRows = Number(remoteCounts?.archived_rows) || 0;
      console.log(
        `[Retention] ${dryRun ? 'DRY-RUN' : 'PURGE'} cutoff=${thresholdDateStr} dispatches=${result.purgedDispatches} deliveries=${result.purgedDeliveries} archived=${result.archivedRows}`
      );
    } catch (e: any) {
      const msg = e?.message || e?.details || String(e);
      if (/RETENTION_LOCKED/.test(msg)) {
        result.locked = true;
        result.error = 'RETENTION_LOCKED';
        return result;
      }
      await recordRetentionError(msg).catch(() => {});
      console.error('[Retention] purge failed:', msg);
      throw e;
    }
  } else if (pgPool) {
    try {
      const rows = await pgPool.query(
        "SELECT id FROM public.dispatches WHERE status = 'completed' AND closed_at IS NOT NULL AND date < $1",
        [thresholdDateStr]
      );
      const dispatchIds = rows.rows.map((r: any) => r.id);
      const res = await pgPool.query('SELECT public.purge_retention($1, $2, $3, $4) AS r', [
        dryRun,
        dispatchIds,
        [],
        RETENTION_DAYS,
      ]);
      remoteCounts = res.rows[0]?.r || null;
      usedRemote = true;
      result.counts = remoteCounts?.counts || null;
      result.purgedDispatches =
        Number(remoteCounts?.purged_dispatches ?? remoteCounts?.counts?.dispatches) || 0;
      result.purgedDeliveries =
        Number(remoteCounts?.purged_deliveries ?? remoteCounts?.counts?.deliveries) || 0;
      result.archivedRows = Number(remoteCounts?.archived_rows) || 0;
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (/RETENTION_LOCKED/.test(msg)) {
        result.locked = true;
        result.error = 'RETENTION_LOCKED';
        return result;
      }
      console.error('[Retention] postgres purge failed:', msg);
      throw e;
    }
  }

  // Yerel yedek depoya (data_store.json) aynı saklama mantığı uygulanır.
  const db = loadLocalDatabase();
  const local = applyRetentionToLocal(
    db.dispatches || [],
    db.deliveries || [],
    thresholdDateStr,
    cutoffInstant
  );

  if (!dryRun) {
    if (!Array.isArray(db.retentionArchive)) db.retentionArchive = [];
    const archivedDispatches = local.archivedDispatches.length;
    const archivedDeliveries = local.archivedDeliveries.length;
    if (archivedDispatches > 0 || archivedDeliveries > 0) {
      db.retentionArchive.push({
        runId: nowIso,
        purgeDate: thresholdDateStr,
        retentionDays: RETENTION_DAYS,
        dispatches: local.archivedDispatches,
        deliveries: local.archivedDeliveries,
      });
      db.dispatches = local.dispatches;
      db.deliveries = local.deliveries;
    }
  }

  if (!usedRemote) {
    result.counts = {
      dispatches: local.archivedDispatches.length,
      deliveries: local.archivedDeliveries.length,
    };
    result.purgedDispatches = dryRun ? 0 : local.archivedDispatches.length;
    result.purgedDeliveries = dryRun ? 0 : local.archivedDeliveries.length;
  }

  const totalThisRun = result.purgedDispatches + result.purgedDeliveries;
  inMemoryLastPurged = totalThisRun;
  inMemoryLastCleanupDate = nowIso;

  db.lastCleanupDate = nowIso;
  db.purgedCountTotal = (db.purgedCountTotal || 0) + totalThisRun;
  saveLocalDatabase(db);

  // NOT: Müşteri profilleri, güncel borç (currentBalanceTL) ve boş kap
  // miktarları kasıtlı olarak %100 korunur; bu fonksiyon onlara dokunmaz.

  return result;
}

export async function getCleanupStats(): Promise<CleanupStatus> {
  const thresholdDateStr = retentionCutoffDate();
  const db = loadLocalDatabase();

  let totalDispatches = db.dispatches?.length || 0;
  let totalDeliveries = db.deliveries?.length || 0;
  let oldestRecordDate: string | null = null;

  if (isSupabaseOperational() && supabase) {
    // Sınırlı okumalar: tam tablo çekmek yerine count ve limit-1 sorguları.
    const [dRes, delRes, oldestD, oldestDel] = await Promise.all([
      supabase.from('dispatches').select('id', { count: 'exact', head: true }),
      supabase.from('deliveries').select('id', { count: 'exact', head: true }),
      supabase.from('dispatches').select('date').order('date', { ascending: true }).limit(1),
      supabase.from('deliveries').select('timestamp').order('timestamp', { ascending: true }).limit(1),
    ]);
    if (!dRes.error && typeof dRes.count === 'number') totalDispatches = dRes.count;
    if (!delRes.error && typeof delRes.count === 'number') totalDeliveries = delRes.count;
    const od = oldestD.data?.[0]?.date as string | undefined;
    const odd = oldestDel.data?.[0]?.timestamp as string | undefined;
    if (od) oldestRecordDate = od;
    else if (odd) oldestRecordDate = odd.split('T')[0];
  } else if (db.dispatches?.length) {
    oldestRecordDate = db.dispatches.map((d) => d.date).sort()[0];
  } else if (db.deliveries?.length) {
    oldestRecordDate = db.deliveries.map((d) => d.timestamp.split('T')[0]).sort()[0];
  }

  const { formatted: nextScheduledRun } = getNext2300Time();
  const health = await getRetentionHealth();

  return {
    totalDispatches,
    totalDeliveries,
    oldestRecordDate,
    retentionDays: RETENTION_DAYS,
    thresholdDate: thresholdDateStr,
    purgedCountLastRun: inMemoryLastPurged,
    purgedCountTotal: db.purgedCountTotal || 0,
    lastCleanupDate: health.lastSuccessAt || inMemoryLastCleanupDate || db.lastCleanupDate || null,
    nextScheduledRun,
    health,
  };
}

// 7. Database Diagnostics & Status Reporter
export async function getDatabaseStatus(): Promise<DatabaseStatus> {
  if (isSupabaseApiConfigured && supabase) {
    const maskedUrl = rawSupabaseUrl ? rawSupabaseUrl.replace(/^(https?:\/\/)([^.]+)(\..+)$/, '$1***$3') : '';
    const local = loadLocalDatabase();

    try {
      const [uRes, pRes, cRes, dRes, delRes] = await Promise.all([
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase.from('products').select('*', { count: 'exact', head: true }),
        supabase.from('customers').select('*', { count: 'exact', head: true }),
        supabase.from('dispatches').select('*', { count: 'exact', head: true }),
        supabase.from('deliveries').select('*', { count: 'exact', head: true }),
      ]);

      const hasError = Boolean(uRes.error || pRes.error || cRes.error || dRes.error || delRes.error);
      const firstError = uRes.error || pRes.error || cRes.error || dRes.error || delRes.error;
      const errorMsg = hasError
        ? (firstError?.message || 'Supabase tablolarına ulaşılamadı')
        : null;

      return {
        type: 'supabase_api',
        isConnected: !hasError,
        provider: 'Supabase (PostgreSQL Bulut API)',
        url: maskedUrl,
        tables: !hasError
          ? {
              users: uRes.count ?? 0,
              products: pRes.count ?? 0,
              customers: cRes.count ?? 0,
              dispatches: dRes.count ?? 0,
              deliveries: delRes.count ?? 0,
            }
          : {
              users: local.users.length,
              products: local.products.length,
              customers: local.customers.length,
              dispatches: local.dispatches.length,
              deliveries: local.deliveries.length,
            },
        message: !hasError
          ? 'Supabase PostgreSQL veritabanına başarıyla bağlanıldı ve tablolar aktif.'
          : `Supabase bağlantı uyarısı: ${errorMsg}.`,
        error: errorMsg,
      };
    } catch (e: any) {
      return {
        type: 'supabase_api',
        isConnected: false,
        provider: 'Supabase (PostgreSQL Bulut API)',
        url: maskedUrl,
        tables: {
          users: local.users.length,
          products: local.products.length,
          customers: local.customers.length,
          dispatches: local.dispatches.length,
          deliveries: local.deliveries.length,
        },
        message: 'Supabase sunucusuna bağlanırken hata oluştu.',
        error: e?.message || String(e),
      };
    }
  }

  if (pgPool) {
    try {
      const client = await pgPool.connect();
      try {
        const uRes = await client.query('SELECT count(*) FROM public.users');
        const pRes = await client.query('SELECT count(*) FROM public.products');
        const cRes = await client.query('SELECT count(*) FROM public.customers');
        const dRes = await client.query('SELECT count(*) FROM public.dispatches');
        const delRes = await client.query('SELECT count(*) FROM public.deliveries');

        return {
          type: 'postgres_direct',
          isConnected: true,
          provider: 'Supabase / PostgreSQL (Doğrudan Veritabanı Havuzu)',
          url: 'postgresql://***:***@db.pooler.supabase.com',
          tables: {
            users: parseInt(uRes.rows[0].count) || 0,
            products: parseInt(pRes.rows[0].count) || 0,
            customers: parseInt(cRes.rows[0].count) || 0,
            dispatches: parseInt(dRes.rows[0].count) || 0,
            deliveries: parseInt(delRes.rows[0].count) || 0,
          },
          message: 'PostgreSQL bağlantı dizesi ile doğrudan veritabanı tablolarına bağlanıldı.',
          error: null,
        };
      } finally {
        client.release();
      }
    } catch (e: any) {
      return {
        type: 'postgres_direct',
        isConnected: false,
        provider: 'Supabase / PostgreSQL (Doğrudan Veritabanı Havuzu)',
        url: 'postgresql://***',
        tables: { users: 0, products: 0, customers: 0, dispatches: 0, deliveries: 0 },
        message: 'PostgreSQL sunucusuna bağlanılamadı.',
        error: e.message || String(e),
      };
    }
  }

  const local = loadLocalDatabase();
  return {
    type: 'local_json',
    isConnected: true,
    provider: 'Yerel JSON Depolama (data_store.json)',
    url: 'data_store.json',
    tables: {
      users: local.users.length,
      products: local.products.length,
      customers: local.customers.length,
      dispatches: local.dispatches.length,
      deliveries: local.deliveries.length,
    },
    message:
      'Supabase ortam değişkenleri (SUPABASE_URL veya DATABASE_URL) tanımlanmadığı için sistem yerel data_store.json ile güvenle çalışıyor.',
    error: null,
  };
}

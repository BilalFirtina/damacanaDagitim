import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import dotenv from 'dotenv';
import {
  User,
  Product,
  Customer,
  Dispatch,
  Delivery,
  CleanupStatus,
  DatabaseStatus,
  sortProductsByCategory,
} from '../types/index.ts';

const { Pool } = pg;

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.resolve(__dirname, '../../data_store.json');

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

export let isSupabaseConfigured = isSupabaseApiConfigured || isPostgresDirectConfigured;

export let supabase: SupabaseClient | null = isSupabaseApiConfigured
  ? createClient(rawSupabaseUrl, rawSupabaseKey, {
      auth: { persistSession: false },
    })
  : null;

export function isSupabaseOperational(): boolean {
  return Boolean(isSupabaseApiConfigured && supabase);
}

export async function checkSupabaseHealth(): Promise<boolean> {
  if (!isSupabaseApiConfigured || !supabase) {
    return false;
  }
  try {
    const { error } = await supabase.from('users').select('id', { head: true, count: 'exact' });
    return !error;
  } catch {
    return false;
  }
}

export async function configureSupabase(cfg: { url?: string; key?: string; enabled?: boolean }) {
  if (cfg.enabled === false) {
    const update = { enabled: false, note: 'Kullanıcı yerel depolama modunu seçti.' };
    saveSupabaseConfig(update);
    activeConfig = update;
    isSupabaseApiConfigured = false;
    supabase = null;
    isSupabaseConfigured = isPostgresDirectConfigured;
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
  isSupabaseConfigured = true;

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
}

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

  const requiredProducts = [
    {
      id: 'prod_cam_damacana',
      name: 'Hayat Cam Damacana',
      category: 'damacana',
      defaultUnitPrice: 110,
      isDeposit: true,
      depositType: 'cam_damacana',
      unit: 'Adet',
      description: 'Hayat cam damacana su - boş cam damacana iadesi zorunlu'
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
    }
  ];

  if (db) {
    if (!db.products) db.products = [];
    let updated = false;
    for (const rp of requiredProducts) {
      if (!db.products.some(p => p.id === rp.id || p.name.toLowerCase() === rp.name.toLowerCase())) {
        db.products.push(rp as any);
        updated = true;
      }
    }
    if (updated) {
      saveLocalDatabase(db);
    }
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
    products: [
      {
        id: 'prod_damacana_19l',
        name: '19L Damacana Su (Polikarbon)',
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
        defaultUnitPrice: 110,
        isDeposit: true,
        depositType: 'cam_damacana',
        unit: 'Adet',
        description: 'Hayat cam damacana su - boş cam damacana iadesi zorunlu'
      },
      {
        id: 'prod_pet_05l',
        name: "0.5L Su (24'lü Koli)",
        category: 'pet',
        defaultUnitPrice: 120,
        isDeposit: false,
        depositType: 'none',
        unit: 'Koli',
        description: '24 adet 0.5 litre paket su'
      },
      {
        id: 'prod_soda',
        name: "Doğal Maden Suyu (24'lü Koli)",
        category: 'soda',
        defaultUnitPrice: 150,
        isDeposit: false,
        depositType: 'none',
        unit: 'Koli',
        description: 'Zengin mineralli doğal maden suyu'
      },
      {
        id: 'prod_tup_tugut',
        name: '12kg Ev Tipi Mutfak Tüpü',
        category: 'tup',
        defaultUnitPrice: 650,
        isDeposit: true,
        depositType: 'tup',
        unit: 'Adet',
        description: '12 kg mutfak tüpü - depozitolu'
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
      }
    ],
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

function mapCustomerFromDb(row: any): Customer {
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
  const localCust = loadLocalDatabase().customers.find((c) => c.id === row.id);
  if (localCust?.emails && localCust.emails.length > 0) {
    localCust.emails.forEach((em) => {
      if (!emails.includes(em)) emails.push(em);
    });
  }

  // Deduplicate
  emails = Array.from(new Set(emails));

  return {
    id: row.id,
    name: row.name,
    phone: row.phone || '',
    address: row.address || '',
    emails,
    isAccountCustomer: Boolean(row.is_account_customer),
    currentBalanceTL: Number(row.current_balance_tl) || 0,
    emptyDepositBalance: {
      damacana: Number(row.empty_deposit_damacana) || 0,
      camDamacana: Number(row.empty_deposit_cam_damacana) || 0,
      tup: Number(row.empty_deposit_tup) || 0,
    },
    customPrices: typeof row.custom_prices === 'object' && row.custom_prices !== null ? row.custom_prices : {},
    notes: row.notes || '',
    createdDate: row.created_date || new Date().toISOString().split('T')[0],
  };
}

function mapDispatchFromDb(row: any): Dispatch {
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
    loadedItems: Array.isArray(row.loaded_items) ? row.loaded_items : [],
    endOfDayReconciliation: row.end_of_day_reconciliation || undefined,
    createdAt: row.created_at || new Date().toISOString(),
  };
}

function mapDeliveryFromDb(row: any): Delivery {
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
    deliveredItems: Array.isArray(row.delivered_items) ? row.delivered_items : [],
    deliveredGrandTotal: Number(row.delivered_grand_total) || 0,
    collectedPayment: row.collected_payment || {
      method: 'UNPAID',
      cashAmount: 0,
      posAmount: 0,
      totalCollected: 0,
      status: 'unpaid',
      diffUncollected: 0,
    },
    emptyContainersReceived: row.empty_containers_received || { damacana: 0, tup: 0 },
    emptyContainersDiff: row.empty_containers_diff || { damacana: 0, tup: 0 },
    notes: row.notes || '',
    isOfflineSync: Boolean(row.is_offline_sync),
  };
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
      const { count, error } = await supabase.from('users').select('*', { count: 'exact', head: true });
      if (!error && (count === 0 || count === null)) {
        console.log('[Supabase] Initializing empty Supabase database with seed data...');
        const local = loadLocalDatabase();

        // 1. Seed users
        if (local.users.length > 0) {
          const userRows = local.users.map((u) => ({
            id: u.id,
            name: u.name,
            username: u.username,
            role: u.role,
            can_load_vehicle: u.canLoadVehicle,
            assigned_plate: u.assignedPlate,
            pin: u.pin,
            phone: u.phone,
          }));
          await supabase.from('users').upsert(userRows, { onConflict: 'id' });
        }

        // 2. Seed products
        if (local.products.length > 0) {
          const prodRows = local.products.map((p) => ({
            id: p.id,
            name: p.name,
            category: p.category,
            default_unit_price: p.defaultUnitPrice,
            is_deposit: p.isDeposit,
            deposit_type: p.depositType,
            unit: p.unit,
            description: p.description,
          }));
          await supabase.from('products').upsert(prodRows, { onConflict: 'id' });
        }

        // 3. Seed customers
        if (local.customers.length > 0) {
          const custRows = local.customers.map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            address: c.address,
            emails: c.emails || [],
            is_account_customer: c.isAccountCustomer,
            current_balance_tl: c.currentBalanceTL,
            empty_deposit_damacana: c.emptyDepositBalance?.damacana || 0,
            empty_deposit_cam_damacana: c.emptyDepositBalance?.camDamacana || 0,
            empty_deposit_tup: c.emptyDepositBalance?.tup || 0,
            custom_prices: c.customPrices || {},
            notes: c.notes || '',
            created_date: c.createdDate,
          }));
          await supabase.from('customers').upsert(custRows, { onConflict: 'id' });
        }

        // 4. Seed dispatches
        if (local.dispatches.length > 0) {
          const dispRows = local.dispatches.map((d) => ({
            id: d.id,
            date: d.date,
            driver_id: d.driverId,
            driver_name: d.driverName,
            vehicle_plate: d.vehiclePlate,
            loaded_by_user_id: d.loadedByUserId,
            loaded_by_user_name: d.loadedByUserName,
            driver_confirmed_at: d.driverConfirmedAt,
            status: d.status,
            loaded_items: d.loadedItems,
            end_of_day_reconciliation: d.endOfDayReconciliation || null,
          }));
          await supabase.from('dispatches').upsert(dispRows, { onConflict: 'id' });
        }

        console.log('[Supabase] Initial seed completed successfully!');
      }
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
  const requiredProducts = [
    {
      id: 'prod_cam_damacana',
      name: 'Hayat Cam Damacana',
      category: 'damacana',
      defaultUnitPrice: 110,
      isDeposit: true,
      depositType: 'cam_damacana',
      unit: 'Adet',
      description: 'Hayat cam damacana su - boş cam damacana iadesi zorunlu'
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
    }
  ];

  if (isSupabaseOperational() && supabase) {
    try {
      const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: true });
      if (!error && data) {
        const existingIds = new Set(data.map((p: any) => p.id));
        const missing = requiredProducts.filter(rp => !existingIds.has(rp.id));
        if (missing.length > 0) {
          await supabase.from('products').upsert(missing.map(p => ({
            id: p.id,
            name: p.name,
            category: p.category,
            default_unit_price: p.defaultUnitPrice,
            is_deposit: p.isDeposit,
            deposit_type: p.depositType,
            unit: p.unit,
            description: p.description,
          })), { onConflict: 'id' });

          const refetch = await supabase.from('products').select('*').order('created_at', { ascending: true });
          if (!refetch.error && refetch.data) {
            return refetch.data.map(mapProductFromDb);
          }
        }
        if (data.length > 0) return data.map(mapProductFromDb);
      }
      if (error) console.error('[Supabase getProducts]', error);
    } catch (e) {
      console.error('[Supabase getProducts Exception]', e);
    }
  } else if (pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM public.products ORDER BY created_at ASC');
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
  }

  const db = loadLocalDatabase();
  const idx = db.products.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  db.products[idx] = { ...db.products[idx], ...updates };
  saveLocalDatabase(db);
  return db.products[idx];
}

export async function deleteProduct(id: string): Promise<boolean> {
  if (isSupabaseOperational() && supabase) {
    try {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) console.error('[Supabase deleteProduct]', error);
    } catch (e) {
      console.error('[Supabase deleteProduct Exception]', e);
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
      if (!error && data && data.length > 0) return data.map(mapCustomerFromDb);
      if (error) console.error('[Supabase getCustomers]', error);
    } catch (e) {
      console.error('[Supabase getCustomers Exception]', e);
    }
  } else if (pgPool) {
    try {
      const res = await pgPool.query('SELECT * FROM public.customers ORDER BY name ASC');
      if (res.rows.length > 0) return res.rows.map(mapCustomerFromDb);
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
        empty_deposit_damacana: cust.emptyDepositBalance?.damacana || 0,
        empty_deposit_cam_damacana: cust.emptyDepositBalance?.camDamacana || 0,
        empty_deposit_tup: cust.emptyDepositBalance?.tup || 0,
        custom_prices: cust.customPrices || {},
        notes: cust.notes || '',
        created_date: cust.createdDate,
      };
      if (cust.emails !== undefined) {
        payload.emails = cust.emails;
      }

      let { data, error } = await supabase
        .from('customers')
        .upsert(payload, { onConflict: 'id' })
        .select()
        .single();

      // Graceful fallback if remote Supabase doesn't have emails column yet
      if (error && (error.message?.includes('emails') || error.code === 'PGRST204')) {
        delete payload.emails;
        const retry = await supabase.from('customers').upsert(payload, { onConflict: 'id' }).select().single();
        data = retry.data;
        error = retry.error;
      }

      if (!error && data) return mapCustomerFromDb({ ...data, emails: cust.emails });
      console.error('[Supabase createCustomer]', error);
    } catch (e) {
      console.error('[Supabase createCustomer Exception]', e);
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
  if (isSupabaseOperational() && supabase) {
    try {
      const payload: any = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.phone !== undefined) payload.phone = updates.phone;
      if (updates.address !== undefined) payload.address = updates.address;
      if (updates.emails !== undefined) {
        payload.emails = updates.emails;
      }
      if (updates.isAccountCustomer !== undefined) payload.is_account_customer = updates.isAccountCustomer;
      if (updates.currentBalanceTL !== undefined) payload.current_balance_tl = updates.currentBalanceTL;
      if (updates.emptyDepositBalance?.damacana !== undefined) {
        payload.empty_deposit_damacana = updates.emptyDepositBalance.damacana;
      }
      if (updates.emptyDepositBalance?.camDamacana !== undefined) {
        payload.empty_deposit_cam_damacana = updates.emptyDepositBalance.camDamacana;
      }
      if (updates.emptyDepositBalance?.tup !== undefined) {
        payload.empty_deposit_tup = updates.emptyDepositBalance.tup;
      }
      if (updates.customPrices !== undefined) payload.custom_prices = updates.customPrices;
      if (updates.notes !== undefined) payload.notes = updates.notes;

      let { data, error } = await supabase
        .from('customers')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (error && (error.message?.includes('emails') || error.code === 'PGRST204')) {
        delete payload.emails;
        const retry = await supabase.from('customers').update(payload).eq('id', id).select().single();
        data = retry.data;
        error = retry.error;
      }

      if (!error && data) return mapCustomerFromDb({ ...data, emails: updates.emails });
      console.error('[Supabase updateCustomer]', error);
    } catch (e) {
      console.error('[Supabase updateCustomer Exception]', e);
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
      if (!error && data) return data.map(mapDispatchFromDb);
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
      return res.rows.map(mapDispatchFromDb);
    } catch (e) {
      console.error('[Postgres getDispatches]', e);
    }
  }

  let list = loadLocalDatabase().dispatches;
  if (date) list = list.filter((d) => d.date === date);
  return list;
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
            loaded_items: disp.loadedItems,
            end_of_day_reconciliation: disp.endOfDayReconciliation || null,
          },
          { onConflict: 'id' }
        )
        .select()
        .single();

      if (!error && data) return mapDispatchFromDb(data);
      console.error('[Supabase createDispatch]', error);
    } catch (e) {
      console.error('[Supabase createDispatch Exception]', e);
    }
  }

  const db = loadLocalDatabase();
  const idx = db.dispatches.findIndex((d) => d.id === disp.id);
  if (idx !== -1) {
    db.dispatches[idx] = disp;
  } else {
    db.dispatches.push(disp);
  }
  saveLocalDatabase(db);
  return disp;
}

export async function updateDispatch(id: string, updates: Partial<Dispatch>): Promise<Dispatch | null> {
  if (isSupabaseOperational() && supabase) {
    try {
      const payload: any = {};
      if (updates.status !== undefined) payload.status = updates.status;
      if (updates.driverConfirmedAt !== undefined) payload.driver_confirmed_at = updates.driverConfirmedAt;
      if (updates.loadedItems !== undefined) payload.loaded_items = updates.loadedItems;
      if (updates.endOfDayReconciliation !== undefined) payload.end_of_day_reconciliation = updates.endOfDayReconciliation;

      const { data, error } = await supabase
        .from('dispatches')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (!error && data) return mapDispatchFromDb(data);
      console.error('[Supabase updateDispatch]', error);
    } catch (e) {
      console.error('[Supabase updateDispatch Exception]', e);
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
      const { data, error } = await query;
      if (!error && data) {
        let list = data.map(mapDeliveryFromDb);
        if (params?.date) {
          list = list.filter((d) => d.timestamp.startsWith(params.date!));
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
  if (params?.date) list = list.filter((d) => d.timestamp.startsWith(params.date!));
  list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return list;
}

export async function createDeliveryRecord(
  del: Delivery,
  updatedCustomer: Customer
): Promise<{ delivery: Delivery; updatedCustomer: Customer }> {
  if (isSupabaseOperational() && supabase) {
    try {
      // 1. Upsert customer FIRST to guarantee foreign key integrity
      await createCustomer(updatedCustomer);

      // 2. Insert delivery record
      const { data: delData, error: delError } = await supabase
        .from('deliveries')
        .upsert(
          {
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
            delivered_items: del.deliveredItems,
            delivered_grand_total: del.deliveredGrandTotal,
            collected_payment: del.collectedPayment,
            empty_containers_received: del.emptyContainersReceived,
            empty_containers_diff: del.emptyContainersDiff,
            notes: del.notes,
            is_offline_sync: del.isOfflineSync,
          },
          { onConflict: 'id' }
        )
        .select()
        .single();

      if (!delError && delData) {
        const savedDel = mapDeliveryFromDb(delData);
        const db = loadLocalDatabase();
        db.deliveries.unshift(savedDel);
        const cIdx = db.customers.findIndex((c) => c.id === updatedCustomer.id);
        if (cIdx !== -1) db.customers[cIdx] = updatedCustomer;
        saveLocalDatabase(db);
        return { delivery: savedDel, updatedCustomer };
      }

      if (delError) {
        console.error('[Supabase createDeliveryRecord]', delError);
      }
    } catch (e) {
      console.error('[Supabase createDeliveryRecord Exception]', e);
    }
  }

  // Local fallback
  const db = loadLocalDatabase();
  db.deliveries.unshift(del);
  const cIdx = db.customers.findIndex((c) => c.id === updatedCustomer.id);
  if (cIdx !== -1) db.customers[cIdx] = updatedCustomer;
  saveLocalDatabase(db);
  return { delivery: del, updatedCustomer };
}

// 6. Retention 60-Day Cleanup Routine (Every night at 23:00 and manual on-demand)
let inMemoryLastPurged = 0;
let inMemoryLastCleanupDate: string | null = null;

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

export async function runRetentionCleanup(): Promise<{
  purgedDispatches: number;
  purgedDeliveries: number;
  lastCleanupDate: string;
  thresholdDate: string;
}> {
  const RETENTION_DAYS = 60;
  const thresholdMs = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
  const thresholdDateStr = new Date(thresholdMs).toISOString().split('T')[0];
  const nowIso = new Date().toISOString();

  let purgedDispatches = 0;
  let purgedDeliveries = 0;

  // 1. Supabase Cleanup (if connected)
  if (isSupabaseOperational() && supabase) {
    try {
      // First delete deliveries older than 60 days
      const { data: delData, error: delErr } = await supabase
        .from('deliveries')
        .delete()
        .lt('timestamp', `${thresholdDateStr}T00:00:00Z`)
        .select();

      // Second delete dispatches older than 60 days
      const { data: dispData, error: dispErr } = await supabase
        .from('dispatches')
        .delete()
        .lt('date', thresholdDateStr)
        .select();

      if (delData) purgedDeliveries = delData.length;
      if (dispData) purgedDispatches = dispData.length;

      if (delErr) console.error('[Supabase Retention Deliveries Error]', delErr);
      if (dispErr) console.error('[Supabase Retention Dispatches Error]', dispErr);

      console.log(`[Supabase 60-Day Cleanup] Purged ${purgedDispatches} dispatches and ${purgedDeliveries} deliveries older than ${thresholdDateStr}.`);
    } catch (e) {
      console.error('[Supabase runRetentionCleanup Exception]', e);
    }
  } else if (pgPool) {
    try {
      const resDel = await pgPool.query('DELETE FROM public.deliveries WHERE timestamp < $1 RETURNING id', [`${thresholdDateStr}T00:00:00Z`]);
      const resDisp = await pgPool.query('DELETE FROM public.dispatches WHERE date < $1 RETURNING id', [thresholdDateStr]);
      purgedDeliveries = resDel.rowCount || 0;
      purgedDispatches = resDisp.rowCount || 0;
    } catch (e) {
      console.error('[Postgres runRetentionCleanup Exception]', e);
    }
  }

  // 2. Local Fallback Database Cleanup (always kept in sync)
  const db = loadLocalDatabase();
  const initDispatches = db.dispatches.length;
  const initDeliveries = db.deliveries.length;

  db.dispatches = db.dispatches.filter((d) => d.date >= thresholdDateStr);
  const retainedIds = new Set(db.dispatches.map((d) => d.id));
  db.deliveries = db.deliveries.filter((del) => del.timestamp.split('T')[0] >= thresholdDateStr && retainedIds.has(del.dispatchId));

  const localPurgedDispatches = initDispatches - db.dispatches.length;
  const localPurgedDeliveries = initDeliveries - db.deliveries.length;

  // Use the greater count between remote and local for reporting
  if (purgedDispatches === 0 && localPurgedDispatches > 0) purgedDispatches = localPurgedDispatches;
  if (purgedDeliveries === 0 && localPurgedDeliveries > 0) purgedDeliveries = localPurgedDeliveries;

  const totalThisRun = purgedDispatches + purgedDeliveries;
  inMemoryLastPurged = totalThisRun;
  inMemoryLastCleanupDate = nowIso;

  db.lastCleanupDate = nowIso;
  db.purgedCountTotal = (db.purgedCountTotal || 0) + totalThisRun;
  saveLocalDatabase(db);

  // NOTE: Customer profiles, active debts (currentBalanceTL), and deposit bottle counts
  // are deliberately 100% untouched and preserved.

  return {
    purgedDispatches,
    purgedDeliveries,
    lastCleanupDate: nowIso,
    thresholdDate: thresholdDateStr,
  };
}

export async function getCleanupStats(): Promise<CleanupStatus> {
  const RETENTION_DAYS = 60;
  const thresholdMs = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
  const thresholdDateStr = new Date(thresholdMs).toISOString().split('T')[0];

  const allDispatches = await getDispatches();
  const allDeliveries = await getDeliveries();
  const db = loadLocalDatabase();

  let oldestRecordDate: string | null = null;
  if (allDispatches.length > 0) {
    const dates = allDispatches.map((d) => d.date).sort();
    oldestRecordDate = dates[0];
  } else if (allDeliveries.length > 0) {
    const dates = allDeliveries.map((d) => d.timestamp.split('T')[0]).sort();
    oldestRecordDate = dates[0];
  }

  const { formatted: nextScheduledRun } = getNext2300Time();

  return {
    totalDispatches: allDispatches.length,
    totalDeliveries: allDeliveries.length,
    oldestRecordDate,
    retentionDays: RETENTION_DAYS,
    thresholdDate: thresholdDateStr,
    purgedCountLastRun: inMemoryLastPurged,
    purgedCountTotal: db.purgedCountTotal || 0,
    lastCleanupDate: inMemoryLastCleanupDate || db.lastCleanupDate || null,
    nextScheduledRun,
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

/**
 * Verification for the bounded `.in()` chunking in `getDeliveries`/`getDispatches`.
 *
 * Run:  npx tsx scripts/verify-read-chunking.ts
 *
 * It spins up a filter-aware mock of the Supabase REST API and:
 *   1. compares the production chunked read against a "legacy" single-`.in()`
 *      read (deep equality) on 1k / 3k / 10k datasets,
 *   2. asserts no request URL exceeds 8 KiB at 3k / 10k,
 *   3. asserts a failed chunk keeps the SAME error handling as before (logged,
 *      no throw, no widening of the local `data_store.json` fallback).
 *
 * SAFETY: every Supabase env var is overwritten with a localhost mock before
 * the DB layer is imported, so this can NEVER reach the production project.
 * It performs NO database writes.
 */
import http from 'http';

const DELIVERY_SIZES = [1000, 3000, 10000];
const DISPATCH_SIZES = [1000, 3000, 10000];
const USERS = 50;
const PRODUCTS = 30;
const CUSTOMERS = 500;
const MAX_URL_BYTES = 8 * 1024;

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Synthetic datasets
// ---------------------------------------------------------------------------
function buildDeliveriesTable(count: number) {
  const deliveries: any[] = [];
  const items: any[] = [];
  const containers: any[] = [];
  const base = 1700000000000;
  for (let i = 0; i < count; i++) {
    const id = `del_${base + i}_abc123`;
    deliveries.push({
      id,
      dispatch_id: `disp_${i % 500}`,
      driver_id: `u${1 + (i % (USERS - 1))}`,
      driver_name: `Kullanıcı ${1 + (i % (USERS - 1))}`,
      vehicle_plate: `01 AA ${100 + (i % 20)}`,
      customer_id: `c${i % CUSTOMERS}`,
      customer_name: `Müşteri ${i % CUSTOMERS}`,
      customer_address: `Adres ${i % CUSTOMERS}`,
      customer_phone: '05551112233',
      timestamp: new Date(base + i * 1000).toISOString(),
      delivered_grand_total: 100 + (i % 50),
      payment_method: 'CASH',
      cash_amount: 100,
      pos_amount: 0,
      total_collected: 100,
      diff_uncollected: i % 50,
      payment_status: i % 3 === 0 ? 'paid' : 'partial',
      notes: '',
      is_offline_sync: false,
      created_at: new Date(base + i * 1000).toISOString(),
    });
    items.push({
      delivery_id: id,
      line_no: 1,
      product_id: `p${i % PRODUCTS}`,
      product_name: `Ürün ${i % PRODUCTS}`,
      quantity: 1 + (i % 5),
      unit_price: 100,
      line_total: 100,
    });
    containers.push({
      delivery_id: id,
      deposit_type: 'damacana',
      received_qty: 1,
      diff_qty: 0,
    });
  }
  return { deliveries, delivery_items: items, delivery_container_returns: containers };
}

function buildDispatchesTable(count: number) {
  const dispatches: any[] = [];
  const items: any[] = [];
  const recons: any[] = [];
  for (let i = 0; i < count; i++) {
    const id = `disp_${i}`;
    dispatches.push({
      id,
      date: '2026-10-19',
      driver_id: `u${1 + (i % (USERS - 1))}`,
      driver_name: `Kullanıcı ${1 + (i % (USERS - 1))}`,
      vehicle_plate: `01 AA ${100 + (i % 20)}`,
      loaded_by_user_id: 'u0',
      loaded_by_user_name: 'Yönetici',
      driver_confirmed_at: new Date(0).toISOString(),
      status: i % 4 === 0 ? 'completed' : 'in_transit',
      created_at: new Date(1700000000000 + i * 1000).toISOString(),
    });
    items.push({ dispatch_id: id, product_id: `p${i % PRODUCTS}`, quantity: 10 + (i % 5) });
    recons.push({
      dispatch_id: id,
      product_id: `p${i % PRODUCTS}`,
      expected_qty: 5,
      counted_qty: 5,
    });
  }
  return { dispatches, dispatch_items: items, dispatch_reconciliation_items: recons };
}

// ---------------------------------------------------------------------------
// Reference mappers — byte-for-byte mirrors of db.ts mapDeliveryFromDb /
// mapDispatchFromDb. Used as the independent oracle for the deep-equality test.
// ---------------------------------------------------------------------------
function refMapDelivery(row: any, itemRows: any[] = [], containerRows: any[] = []) {
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

function refMapDispatch(row: any, loadedItems: any[] = [], reconRows: any[] = []) {
  const remainingFullExpected: Record<string, number> = {};
  const remainingFullCounted: Record<string, number> = {};
  for (const r of reconRows || []) {
    if (!r || typeof r.product_id !== 'string') continue;
    remainingFullExpected[r.product_id] = Number(r.expected_qty) || 0;
    remainingFullCounted[r.product_id] = Number(r.counted_qty) || 0;
  }
  const endOfDayReconciliation = row.closed_at
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

// ---------------------------------------------------------------------------
// Mock Supabase REST endpoint (filter aware)
// ---------------------------------------------------------------------------
let tables: Record<string, any[]> = {};
let maxUrlLen = 0;
let requestCount = 0;
let failOnceTable = '';

function rowMatches(rows: any[], key: string, token: string): any[] {
  if (token.startsWith('in.(') && token.endsWith(')')) {
    const set = new Set(token.slice(4, -1).split(','));
    return rows.filter((r) => set.has(String(r[key])));
  }
  if (token.startsWith('eq.')) {
    const v = token.slice(3);
    return rows.filter((r) => String(r[key]) === v);
  }
  return rows;
}

async function main() {
  const server = http.createServer({ maxHeaderSize: 64 * 1024 * 1024 }, (req, res) => {
    maxUrlLen = Math.max(maxUrlLen, (req.url || '').length);
    requestCount++;
    const url = new URL(req.url || '/', 'http://localhost');
    const table = url.pathname.replace(/^\/rest\/v1\//, '');
    let rows = (tables[table] || []).slice();
    for (const [key, val] of url.searchParams.entries()) {
      if (key === 'select' || key === 'order' || key === 'limit' || key === 'offset') continue;
      rows = rowMatches(rows, key, val);
    }
    if (failOnceTable === table) {
      failOnceTable = '';
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ message: 'injected failure', code: 'TEST_FAILURE' }));
      return;
    }
    const body = JSON.stringify(rows);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Range', `0-${Math.max(0, rows.length - 1)}/*`);
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  for (const k of ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
    process.env[k] = `http://127.0.0.1:${port}`;
  }
  for (const k of [
    'SUPABASE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
    'SUPABASE_KEY',
    'VITE_SUPABASE_ANON_KEY',
  ]) {
    process.env[k] = 'sb_secret_chunk_test_dummy';
  }
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.SUPABASE_DB_URL;

  const db = await import('../src/server/db.ts');

  const legacyQuery = async (table: string, params: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`http://127.0.0.1:${port}/rest/v1/${table}?${qs}`);
    return (await res.json()) as any[];
  };

  console.log('\n[read chunking verification]\n');

  for (const size of DELIVERY_SIZES) {
    tables = buildDeliveriesTable(size);
    const rows = tables.deliveries;
    const ids = rows.map((r: any) => r.id);
    const legacyItems = await legacyQuery('delivery_items', {
      select: 'delivery_id,line_no,product_id,product_name,quantity,unit_price,line_total',
      delivery_id: `in.(${ids.join(',')})`,
    });
    const legacyContainers = await legacyQuery('delivery_container_returns', {
      select: 'delivery_id,deposit_type,received_qty,diff_qty',
      delivery_id: `in.(${ids.join(',')})`,
    });
    const legacy = rows.map((r: any) =>
      refMapDelivery(
        r,
        legacyItems.filter((i) => i.delivery_id === r.id),
        legacyContainers.filter((c) => c.delivery_id === r.id)
      )
    );

    maxUrlLen = 0;
    requestCount = 0;
    const got = await db.getDeliveries();

    check(
      `getDeliveries deep-equals legacy at ${size}`,
      JSON.stringify(got) === JSON.stringify(legacy),
      `new=${got.length} legacy=${legacy.length}`
    );
    check(
      `getDeliveries issued chunked requests at ${size}`,
      requestCount > 5,
      `requests=${requestCount}`
    );
    if (size >= 3000) {
      check(
        `getDeliveries max request URL <= 8 KiB at ${size}`,
        maxUrlLen <= MAX_URL_BYTES,
        `maxUrl=${maxUrlLen} bytes`
      );
    }
  }

  for (const size of DISPATCH_SIZES) {
    tables = buildDispatchesTable(size);
    const rows = tables.dispatches;
    const ids = rows.map((r: any) => r.id);
    const legacyItems = await legacyQuery('dispatch_items', {
      select: 'dispatch_id,product_id,quantity',
      dispatch_id: `in.(${ids.join(',')})`,
    });
    const legacyRecons = await legacyQuery('dispatch_reconciliation_items', {
      select: 'dispatch_id,product_id,expected_qty,counted_qty',
      dispatch_id: `in.(${ids.join(',')})`,
    });
    const legacy = rows.map((r: any) =>
      refMapDispatch(
        r,
        legacyItems.filter((i) => i.dispatch_id === r.id),
        legacyRecons.filter((i) => i.dispatch_id === r.id)
      )
    );

    maxUrlLen = 0;
    requestCount = 0;
    const got = await db.getDispatches();

    check(
      `getDispatches deep-equals legacy at ${size}`,
      JSON.stringify(got) === JSON.stringify(legacy),
      `new=${got.length} legacy=${legacy.length}`
    );
    check(
      `getDispatches issued chunked requests at ${size}`,
      requestCount > 5,
      `requests=${requestCount}`
    );
    if (size >= 3000) {
      check(
        `getDispatches max request URL <= 8 KiB at ${size}`,
        maxUrlLen <= MAX_URL_BYTES,
        `maxUrl=${maxUrlLen} bytes`
      );
    }
  }

  // Failed chunk: logged, no throw, no widening of the local fallback.
  const size = 1000;
  tables = buildDeliveriesTable(size);
  failOnceTable = 'delivery_items';
  let threw = false;
  let result: any[] = [];
  try {
    result = await db.getDeliveries();
  } catch {
    threw = true;
  }
  check('failed chunk does not throw', !threw);
  check(
    'failed chunk still returns the main rows (no data_store.json fallback)',
    result.length === size,
    `got=${result.length} expected=${size}`
  );

  server.close();
}

await main();

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * Benchmark: two read paths against a local mock Supabase REST endpoint.
 *
 * Mode `prefetch` (default): the read prefetch performed by `POST /api/deliveries`.
 *   server.ts:893 runs exactly:
 *     Promise.all([ getDispatches(), getUsers(), getCustomers(), getProducts() ])
 *   Sizes: dispatches = 1000, 10000, 50000.
 *
 * Mode `deliveries`: full-history `getDeliveries()` with no filter. This is the
 *   path used by `getCleanupStats()` (db.ts:3581) and any unfiltered
 *   `/api/deliveries` request. It builds an `.in('delivery_id', ids)` query, so
 *   the measured `maxUrlLen` is the critical value (Node's default request-line
 *   limit is ~16 KiB; many gateways reject > ~8 KiB).
 *   Sizes: deliveries = 1000, 3000, 10000.
 *
 * This script measures those calls with synthetic datasets. It performs NO
 * database writes.
 *
 * Run:  npx tsx scripts/bench-deliveries-prefetch.ts
 *
 * SAFETY: before importing the DB layer this script overwrites every Supabase
 * env var with a localhost mock URL and a dummy key, so it can NEVER connect to
 * the production project. `DATABASE_URL`-style vars are cleared as well.
 */
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const PREFETCH_SIZES = [1000, 10000, 50000];
const DELIVERY_SIZES = [1000, 3000, 10000];
const USERS = 50;
const PRODUCTS = 30;
const CUSTOMERS = 500;
const ITEMS_PER_DISPATCH = 1;
const RECON_PER_DISPATCH = 1;
const DELIVERY_ITEMS_PER_DELIVERY = 1;
const DELIVERY_CONTAINERS_PER_DELIVERY = 1;

function buildRows(dispatchCount: number) {
  const users = Array.from({ length: USERS }, (_, i) => ({
    id: `u${i}`,
    name: `Kullanıcı ${i}`,
    username: `user${i}`,
    role: i === 0 ? 'admin' : 'driver',
    can_load_vehicle: i % 5 === 0,
    is_lead_driver: i === 1,
    assigned_plate: `01 AA ${100 + i}`,
    pin: '1234',
    phone: '05550000000',
    created_at: new Date(0).toISOString(),
  }));

  const products = Array.from({ length: PRODUCTS }, (_, i) => ({
    id: `p${i}`,
    name: `Ürün ${i}`,
    category: i % 2 === 0 ? 'damacana' : 'pet',
    default_unit_price: 100 + i,
    is_deposit: i % 2 === 0,
    deposit_type: i % 2 === 0 ? 'damacana' : 'none',
    unit: 'Adet',
    description: '',
    is_active: true,
    created_at: new Date(0).toISOString(),
  }));

  const customers = Array.from({ length: CUSTOMERS }, (_, i) => ({
    id: `c${i}`,
    name: `Müşteri ${i}`,
    phone: '05551112233',
    address: `Adres ${i}`,
    is_account_customer: i % 3 === 0,
    current_balance_tl: i * 10,
    notes: '',
    created_date: '2026-01-01',
  }));

  const dispatches: any[] = [];
  const dispatchItems: any[] = [];
  const reconItems: any[] = [];

  for (let i = 0; i < dispatchCount; i++) {
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
    for (let k = 0; k < ITEMS_PER_DISPATCH; k++) {
      dispatchItems.push({ dispatch_id: id, product_id: `p${k % PRODUCTS}`, quantity: 10 + k });
    }
    for (let k = 0; k < RECON_PER_DISPATCH; k++) {
      reconItems.push({
        dispatch_id: id,
        product_id: `p${k % PRODUCTS}`,
        expected_qty: 5,
        counted_qty: 5,
      });
    }
  }

  return {
    users,
    products,
    customers,
    dispatches,
    dispatch_items: dispatchItems,
    dispatch_reconciliation_items: reconItems,
  };
}

function buildDeliveryRows(deliveryCount: number) {
  const deliveries: any[] = [];
  const deliveryItems: any[] = [];
  const deliveryContainers: any[] = [];

  const baseTs = 1700000000000;
  for (let i = 0; i < deliveryCount; i++) {
    // Same shape/length as client ids (`del_<epoch_ms>_<rand>`), ~24 chars.
    const id = `del_${baseTs + i}_abc123`;
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
      timestamp: new Date(baseTs + i * 1000).toISOString(),
      delivered_grand_total: 100 + (i % 50),
      payment_method: 'CASH',
      cash_amount: 100,
      pos_amount: 0,
      total_collected: 100,
      diff_uncollected: i % 50,
      payment_status: i % 3 === 0 ? 'paid' : 'partial',
      notes: '',
      is_offline_sync: false,
      created_at: new Date(baseTs + i * 1000).toISOString(),
    });
    for (let k = 0; k < DELIVERY_ITEMS_PER_DELIVERY; k++) {
      deliveryItems.push({
        delivery_id: id,
        line_no: k + 1,
        product_id: `p${k % PRODUCTS}`,
        product_name: `Ürün ${k % PRODUCTS}`,
        quantity: 1 + (i % 5),
        unit_price: 100,
        line_total: 100,
      });
    }
    for (let k = 0; k < DELIVERY_CONTAINERS_PER_DELIVERY; k++) {
      deliveryContainers.push({
        delivery_id: id,
        deposit_type: 'damacana',
        received_qty: 1,
        diff_qty: 0,
      });
    }
  }

  return {
    deliveries,
    delivery_items: deliveryItems,
    delivery_container_returns: deliveryContainers,
  };
}

async function runChild(size: number, mode: string): Promise<void> {
  // Overwrite all Supabase env with a localhost placeholder BEFORE importing db.
  const dummy = 'http://127.0.0.1:0';
  for (const k of ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
    process.env[k] = dummy;
  }
  for (const k of [
    'SUPABASE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
    'SUPABASE_KEY',
    'VITE_SUPABASE_ANON_KEY',
  ]) {
    process.env[k] = 'sb_secret_benchmark_dummy';
  }
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.SUPABASE_DB_URL;

  const tables: Record<string, any[]> =
    mode === 'deliveries' ? buildDeliveryRows(size) : buildRows(size);
  let servedBytes = 0;
  let maxUrlLen = 0;

  const tableFor = (pathname: string): any[] => {
    const table = pathname.replace(/^\/rest\/v1\//, '');
    return tables[table] || [];
  };

  const server = http.createServer({ maxHeaderSize: 64 * 1024 * 1024 }, (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    maxUrlLen = Math.max(maxUrlLen, (req.url || '').length);
    const body = JSON.stringify(tableFor(url.pathname));
    servedBytes += Buffer.byteLength(body);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Range', `0-${Math.max(0, tableFor(url.pathname).length - 1)}/*`);
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  // Re-point the dummy URL at the real bound port (query is ignored).
  for (const k of ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
    process.env[k] = `http://127.0.0.1:${port}`;
  }

  const db = await import('../src/server/db.ts');

  const prefetch = async () => {
    const [dispatches, users, customers, products] = await Promise.all([
      db.getDispatches(),
      db.getUsers(),
      db.getCustomers(),
      db.getProducts(),
    ]);
    return { dispatches: dispatches.length, users: users.length, customers: customers.length, products: products.length };
  };

  const readDeliveries = async () => {
    const list = await db.getDeliveries();
    return { deliveries: list.length, items: list.reduce((n, d) => n + d.deliveredItems.length, 0) };
  };

  const timed = mode === 'deliveries' ? readDeliveries : prefetch;

  const runs: number[] = [];
  const verify = await timed(); // warm-up + correctness probe

  const iterations = size >= 50000 ? 2 : 3;
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await timed();
    runs.push(Math.round((performance.now() - t0) * 10) / 10);
  }

  server.close();
  console.log(
    'BENCH_RESULT ' +
      JSON.stringify({
        size,
        mode,
        runs,
        median: runs.slice().sort((a, b) => a - b)[Math.floor(runs.length / 2)],
        servedBytes,
        maxUrlLen,
        verify,
      })
  );
}

if (process.argv.includes('--size')) {
  const sizeIdx = process.argv.indexOf('--size');
  const modeIdx = process.argv.indexOf('--mode');
  const mode = modeIdx >= 0 ? process.argv[modeIdx + 1] : 'prefetch';
  await runChild(Number(process.argv[sizeIdx + 1]), mode);
  process.exit(0);
}

// Parent: run each size in a child process with a hard timeout so a runaway
// quadratic pass cannot hang the whole command.
const scriptPath = fileURLToPath(import.meta.url);
const tsxCli = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'node_modules',
  'tsx',
  'dist',
  'cli.mjs'
);
const results: any[] = [];

async function runWithTimeout(size: number, mode: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsxCli, scriptPath, '--size', String(size), '--mode', mode], {
      env: process.env,
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ size, mode, timeout: true, timeoutMs });
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('close', () => {
      clearTimeout(timer);
      const line = out.split('\n').reverse().find((l) => l.startsWith('BENCH_RESULT '));
      if (!line) return resolve({ size, mode, error: 'no result', out: out.slice(-500) });
      resolve(JSON.parse(line.slice('BENCH_RESULT '.length)));
    });
  });
}

function report(r: any, label: string) {
  if (r.timeout) {
    console.log(`  ${label}: TIMEOUT (>${(r.timeoutMs / 1000).toFixed(0)}s, killed)`);
  } else if (r.error) {
    console.log(`  ${label}: ERROR ${r.error} ${r.out || ''}`);
  } else {
    console.log(
      `  ${label}: median ${r.median} ms  runs=[${r.runs.join(', ')}] ms  payload=${(
        r.servedBytes / 1024
      ).toFixed(1)} KiB  maxUrl=${(r.maxUrlLen / 1024).toFixed(1)} KiB  mapped=${JSON.stringify(
        r.verify
      )}`
    );
  }
}

console.log('\n[POST /api/deliveries prefetch benchmark]');
console.log(
  `dataset per size: dispatches=N, items/dispatch=${ITEMS_PER_DISPATCH}, recon/dispatch=${RECON_PER_DISPATCH}, users=${USERS}, products=${PRODUCTS}, customers=${CUSTOMERS}\n`
);
for (const size of PREFETCH_SIZES) {
  const timeoutMs = size === 50000 ? 240000 : 120000;
  const r = await runWithTimeout(size, 'prefetch', timeoutMs);
  results.push(r);
  report(r, `N=${size}`);
}

console.log('\n[getDeliveries full-history benchmark]');
console.log(
  `dataset per size: deliveries=N, items/delivery=${DELIVERY_ITEMS_PER_DELIVERY}, containers/delivery=${DELIVERY_CONTAINERS_PER_DELIVERY}\n`
);
for (const size of DELIVERY_SIZES) {
  const r = await runWithTimeout(size, 'deliveries', 120000);
  results.push(r);
  report(r, `N=${size}`);
}

console.log('');

/**
 * Benchmark: the read prefetch performed by `POST /api/deliveries`.
 *
 * server.ts:893 runs exactly:
 *   Promise.all([ getDispatches(), getUsers(), getCustomers(), getProducts() ])
 *
 * This script measures that call against a local mock Supabase REST endpoint
 * with synthetic datasets, so it indicates how the prefetch scales with the
 * number of dispatches. It performs NO database writes.
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

const SIZES = [1000, 10000, 50000];
const USERS = 50;
const PRODUCTS = 30;
const CUSTOMERS = 500;
const ITEMS_PER_DISPATCH = 1;
const RECON_PER_DISPATCH = 1;

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

  return { users, products, customers, dispatches, dispatchItems, reconItems };
}

async function runChild(size: number): Promise<void> {
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

  const rows = buildRows(size);
  let servedBytes = 0;
  let maxUrlLen = 0;

  const tableFor = (pathname: string): any[] => {
    const table = pathname.replace(/^\/rest\/v1\//, '');
    switch (table) {
      case 'users':
        return rows.users;
      case 'products':
        return rows.products;
      case 'customers':
        return rows.customers;
      case 'dispatches':
        return rows.dispatches;
      case 'dispatch_items':
        return rows.dispatchItems;
      case 'dispatch_reconciliation_items':
        return rows.reconItems;
      default:
        return [];
    }
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

  const runs: number[] = [];
  const verify = await prefetch(); // warm-up + correctness probe

  const iterations = size >= 50000 ? 2 : 3;
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await prefetch();
    runs.push(Math.round((performance.now() - t0) * 10) / 10);
  }

  server.close();
  console.log(
    'BENCH_RESULT ' +
      JSON.stringify({
        size,
        runs,
        median: runs.slice().sort((a, b) => a - b)[Math.floor(runs.length / 2)],
        servedBytes,
        maxUrlLen,
        verify,
      })
  );
}

if (process.argv.includes('--size')) {
  const idx = process.argv.indexOf('--size');
  await runChild(Number(process.argv[idx + 1]));
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

async function runWithTimeout(size: number, timeoutMs: number): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsxCli, scriptPath, '--size', String(size)], {
      env: process.env,
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ size, timeout: true, timeoutMs });
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('close', () => {
      clearTimeout(timer);
      const line = out.split('\n').reverse().find((l) => l.startsWith('BENCH_RESULT '));
      if (!line) return resolve({ size, error: 'no result', out: out.slice(-500) });
      resolve(JSON.parse(line.slice('BENCH_RESULT '.length)));
    });
  });
}

console.log('\n[POST /api/deliveries prefetch benchmark]');
console.log(
  `dataset per size: dispatches=N, items/dispatch=${ITEMS_PER_DISPATCH}, recon/dispatch=${RECON_PER_DISPATCH}, users=${USERS}, products=${PRODUCTS}, customers=${CUSTOMERS}\n`
);

for (const size of SIZES) {
  const timeoutMs = size === 50000 ? 240000 : 120000;
  const r = await runWithTimeout(size, timeoutMs);
  results.push(r);
  if (r.timeout) {
    console.log(`  N=${size}: TIMEOUT (>${(r.timeoutMs / 1000).toFixed(0)}s, killed)`);
  } else if (r.error) {
    console.log(`  N=${size}: ERROR ${r.error} ${r.out || ''}`);
  } else {
    console.log(
      `  N=${size}: median ${r.median} ms  runs=[${r.runs.join(', ')}] ms  payload=${(
        r.servedBytes / 1024
      ).toFixed(0)} KiB  mapped=${JSON.stringify(r.verify)}`
    );
  }
}

console.log('');

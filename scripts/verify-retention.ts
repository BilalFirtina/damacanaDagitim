/**
 * Verification for the 60-day retention policy.
 *
 * Run:  npx tsx scripts/verify-retention.ts
 *
 * Part A — pure rules (src/services/retentionRules.ts + dateWindow.ts):
 *   boundary 59/60/61, open dispatches, closed requirement, cascading
 *   deliveries, orphan deliveries, and proof that balances/consignments are
 *   never part of the selection.
 *
 * Part B — server orchestration against a mock PostgREST endpoint:
 *   dry-run default, lock rejection, archive-failure abort, success counts,
 *   and error recording.
 *
 * SAFETY: Supabase env is overwritten with a localhost mock before importing
 * the DB layer. `data_store.json` is backed up and restored, so the test never
 * changes repository data. It performs NO production writes and no real SQL.
 *
 * NOTE: the real SQL function public.purge_retention is NOT executed here
 * (no local Postgres). Its selection predicate is mirrored by the pure rules
 * tested in Part A and must be validated on staging with a dry-run.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  RETENTION_DAYS,
  retentionCutoffDate,
  retentionCutoffInstant,
} from '../src/services/dateWindow.ts';
import {
  isDispatchPurgeEligible,
  selectRetentionIds,
  applyRetentionToLocal,
} from '../src/services/retentionRules.ts';
import type { Dispatch, Delivery } from '../src/types/index.ts';

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

function dayOffset(baseIso: string, days: number): string {
  const t = new Date(baseIso).getTime() + days * 24 * 60 * 60 * 1000;
  return new Date(t).toISOString().split('T')[0];
}

function makeDispatch(over: Partial<Dispatch>): Dispatch {
  return {
    id: 'd1',
    date: '2020-01-01',
    driverId: 'u1',
    driverName: 'Sürücü',
    vehiclePlate: '01 AA 001',
    loadedByUserId: 'u0',
    loadedByUserName: 'Yönetici',
    driverConfirmedAt: null,
    status: 'completed',
    loadedItems: [],
    endOfDayReconciliation: {
      closedAt: '2020-01-01T20:00:00.000Z',
      closedByUserId: 'u0',
      closedByUserName: 'Yönetici',
      remainingFullCounted: {},
      remainingFullExpected: {},
      collectedEmptyDamacana: 0,
      collectedEmptyTup: 0,
      actualCashInPocket: 0,
      actualPosSlipsTotal: 0,
      totalDeliveredValue: 0,
      totalCashCollected: 0,
      totalPosCollected: 0,
      totalCreditAdded: 0,
    },
    createdAt: '2020-01-01T08:00:00.000Z',
    ...over,
  };
}

function makeDelivery(over: Partial<Delivery>): Delivery {
  return {
    id: 'del1',
    dispatchId: 'd1',
    driverId: 'u1',
    driverName: 'Sürücü',
    vehiclePlate: '01 AA 001',
    customerId: 'c1',
    customerName: 'Müşteri',
    customerAddress: '',
    timestamp: '2020-01-01T10:00:00.000Z',
    deliveredItems: [],
    deliveredGrandTotal: 0,
    collectedPayment: {
      method: 'UNPAID',
      cashAmount: 0,
      posAmount: 0,
      totalCollected: 0,
      status: 'unpaid',
      diffUncollected: 0,
    },
    emptyContainersReceived: { damacana: 0, tup: 0 },
    emptyContainersDiff: { damacana: 0, tup: 0 },
    notes: '',
    isOfflineSync: false,
    ...over,
  };
}

function partA() {
  console.log('1) Pure retention rules');

  check('RETENTION_DAYS is 60', RETENTION_DAYS === 60);

  const now = '2026-10-19T12:00:00.000Z';
  const cutoff = retentionCutoffDate(new Date(now));
  const cutoffInstant = retentionCutoffInstant(new Date(now));
  check('cutoff is 60 days before now', cutoff === dayOffset(now, -60), `cutoff=${cutoff}`);
  check(
    'cutoff instant is UTC midnight',
    cutoffInstant === `${cutoff}T00:00:00.000Z`,
    cutoffInstant
  );

  const eligible = makeDispatch({ id: 'old', date: dayOffset(now, -61) });
  const atBoundary = makeDispatch({ id: 'boundary', date: cutoff });
  const recent = makeDispatch({ id: 'recent', date: dayOffset(now, -59) });
  check('61 days old -> eligible', isDispatchPurgeEligible(eligible, cutoff));
  check('exactly 60 days old (== cutoff) -> kept', !isDispatchPurgeEligible(atBoundary, cutoff));
  check('59 days old -> kept', !isDispatchPurgeEligible(recent, cutoff));

  // UTC day-boundary stability
  const c1 = retentionCutoffDate(new Date('2026-10-19T00:00:00.000Z'));
  const c2 = retentionCutoffDate(new Date('2026-10-19T23:59:59.999Z'));
  check('cutoff stable across the UTC day', c1 === c2, `${c1} vs ${c2}`);

  // Open / unclosed dispatches are never eligible, even if very old.
  check(
    'in_transit old dispatch -> never eligible',
    !isDispatchPurgeEligible(
      makeDispatch({ id: 'x', date: dayOffset(now, -400), status: 'in_transit' }),
      cutoff
    )
  );
  check(
    'pending_confirmation old dispatch -> never eligible',
    !isDispatchPurgeEligible(
      makeDispatch({ id: 'y', date: dayOffset(now, -400), status: 'pending_confirmation' }),
      cutoff
    )
  );
  check(
    'completed but not closed -> never eligible',
    !isDispatchPurgeEligible(
      makeDispatch({ id: 'z', date: dayOffset(now, -400), endOfDayReconciliation: undefined }),
      cutoff
    )
  );

  // Selection: cascading deliveries, orphans, non-eligible protection.
  const dispatches = [eligible, atBoundary, recent];
  const deliveries = [
    makeDelivery({ id: 'del_old', dispatchId: 'old', timestamp: '2020-01-01T00:00:00.000Z' }),
    makeDelivery({ id: 'del_new_of_old', dispatchId: 'old', timestamp: now }), // newer than cutoff, still purged
    makeDelivery({ id: 'del_kept_disp', dispatchId: 'recent', timestamp: '2020-01-01T00:00:00.000Z' }),
    makeDelivery({ id: 'orphan_old', dispatchId: '', timestamp: cutoffInstant.slice(0, -1) }), // just before cutoff
    makeDelivery({ id: 'orphan_new', dispatchId: '', timestamp: now }),
  ];
  const sel = selectRetentionIds(dispatches, deliveries, cutoff, cutoffInstant);
  check('only the 61-day dispatch is selected', JSON.stringify(sel.dispatchIds) === '["old"]', JSON.stringify(sel.dispatchIds));
  check(
    'delivery of eligible dispatch purged regardless of its own date',
    sel.deliveryIds.includes('del_new_of_old')
  );
  check('old delivery of eligible dispatch purged', sel.deliveryIds.includes('del_old'));
  check('delivery of non-eligible dispatch kept', !sel.deliveryIds.includes('del_kept_disp'));
  check('old orphan delivery purged', sel.deliveryIds.includes('orphan_old'));
  check('new orphan delivery kept', !sel.deliveryIds.includes('orphan_new'));

  // Local application must not touch balances/consignments.
  const local = applyRetentionToLocal(dispatches, deliveries, cutoff, cutoffInstant);
  check('local keeps non-eligible dispatches', local.dispatches.map((d) => d.id).join(',') === 'boundary,recent');
  check('local archived exactly the eligible dispatch', local.archivedDispatches.map((d) => d.id).join(',') === 'old');
  check(
    'local archived deliveries are disjoint from retained',
    local.archivedDeliveries.every((a) => !local.deliveries.some((k) => k.id === a.id))
  );
  const customers = [{ id: 'c1', currentBalanceTL: 500, emptyDepositBalance: { damacana: 3, tup: 1 } }];
  const before = JSON.stringify(customers);
  applyRetentionToLocal(dispatches, deliveries, cutoff, cutoffInstant);
  check('balances/consignments untouched (byte-identical)', JSON.stringify(customers) === before);
}

// ---------------------------------------------------------------------------
// Part B: orchestration against a mock PostgREST endpoint.
// ---------------------------------------------------------------------------
let tables: Record<string, any[]> = {};
let rpcMode: 'ok' | 'locked' | 'archive_fail' = 'ok';
let rpcBody: any = null;
let statePatches: any[] = [];

async function partB() {
  console.log('\n2) Server orchestration (mock RPC)');

  const server = http.createServer({ maxHeaderSize: 64 * 1024 * 1024 }, (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      let body: any = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      res.setHeader('Content-Type', 'application/json');

      const p = url.pathname;
      if (p === '/rest/v1/rpc/purge_retention') {
        rpcBody = body;
        if (rpcMode === 'locked') {
          res.statusCode = 409;
          res.end(JSON.stringify({ message: 'RETENTION_LOCKED', code: 'P0001' }));
          return;
        }
        if (rpcMode === 'archive_fail') {
          res.statusCode = 500;
          res.end(JSON.stringify({ message: 'ARCHIVE_COUNT_MISMATCH: expected 5 archived 4', code: 'P0001' }));
          return;
        }
        res.end(
          JSON.stringify({
            run_id: 'ret_test',
            dry_run: body?.p_dry_run,
            threshold_date: '2026-08-20',
            retention_days: 60,
            counts: {
              dispatches: 2,
              deliveries: 3,
              dispatch_items: 2,
              dispatch_reconciliation_items: 2,
              delivery_items: 3,
              delivery_container_returns: 0,
              archived_rows: 12,
            },
            archived_rows: 12,
            purged_dispatches: body?.p_dry_run ? 0 : 2,
            purged_deliveries: body?.p_dry_run ? 0 : 3,
          })
        );
        return;
      }

      if (p === '/rest/v1/retention_state') {
        if (req.method === 'PATCH' || req.method === 'POST' || req.method === 'PUT') {
          statePatches.push(body);
          res.end(JSON.stringify(body || null));
          return;
        }
        res.end(JSON.stringify(null));
        return;
      }

      const table = p.replace(/^\/rest\/v1\//, '');
      let rows = (tables[table] || []).slice();
      for (const [key, val] of url.searchParams.entries()) {
        if (key === 'select' || key === 'order' || key === 'limit') continue;
        if (val.startsWith('lt.')) {
          const v = val.slice(3);
          rows = rows.filter((r) => String(r[key]) < v);
        } else if (val.startsWith('eq.')) {
          const v = val.slice(3);
          rows = rows.filter((r) => String(r[key]) === v);
        }
      }
      res.end(JSON.stringify(rows));
    });
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
    process.env[k] = 'sb_secret_retention_test_dummy';
  }
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.SUPABASE_DB_URL;

  const db = await import('../src/server/db.ts');

  // Datasets served to the app's bounded eligible-dispatch query.
  tables = {
    dispatches: [
      { id: 'old_completed', status: 'completed', closed_at: '2020-01-01T00:00:00.000Z', date: '2020-01-01' },
      { id: 'old_open', status: 'in_transit', closed_at: null, date: '2020-01-01' },
      { id: 'recent_completed', status: 'completed', closed_at: '2026-10-01T00:00:00.000Z', date: '2026-10-01' },
    ],
  };

  // Cleanup that writes data_store.json must be backed up/restored.
  const DATA_FILE = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'data_store.json'
  );
  const original = fs.readFileSync(DATA_FILE, 'utf-8');
  try {
    // (1) dry-run is the default.
    delete process.env.RETENTION_DRY_RUN;
    rpcMode = 'ok';
    rpcBody = null;
    const dry = await db.runRetentionCleanup();
    check('default is dry-run', dry.dryRun === true);
    check('dry-run sends p_dry_run=true to RPC', rpcBody?.p_dry_run === true);
    check('dry-run reports archived rows', dry.archivedRows === 12);
    check('dry-run reports 0 real deletions', dry.purgedDispatches === 0 && dry.purgedDeliveries === 0);
    check(
      'only eligible dispatch id passed (open/recent excluded)',
      JSON.stringify(rpcBody?.p_dispatch_ids) === '["old_completed"]',
      JSON.stringify(rpcBody?.p_dispatch_ids)
    );

    // (2) explicit real-run flag.
    process.env.RETENTION_DRY_RUN = 'false';
    rpcMode = 'ok';
    rpcBody = null;
    const real = await db.runRetentionCleanup();
    check('RETENTION_DRY_RUN=false -> dryRun false', real.dryRun === false);
    check('real run sends p_dry_run=false', rpcBody?.p_dry_run === false);
    check('real run reports purge counts', real.purgedDispatches === 2 && real.purgedDeliveries === 3);

    // (3) lock rejection.
    rpcMode = 'locked';
    statePatches = [];
    const locked = await db.runRetentionCleanup();
    check('lock -> locked result, no throw', locked.locked === true);
    check('lock -> not recorded as an error', !statePatches.some((s) => s && s.last_error));

    // (4) archive failure aborts and records the error.
    rpcMode = 'archive_fail';
    statePatches = [];
    let threw = false;
    try {
      await db.runRetentionCleanup();
    } catch {
      threw = true;
    }
    check('archive failure throws (zero deletions)', threw);
    check(
      'archive failure recorded last_error',
      statePatches.some((s) => s && typeof s.last_error === 'string' && s.last_error.includes('ARCHIVE_COUNT_MISMATCH')),
      JSON.stringify(statePatches)
    );
  } finally {
    fs.writeFileSync(DATA_FILE, original, 'utf-8');
    delete process.env.RETENTION_DRY_RUN;
    server.close();
  }
}

partA();
await partB();

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

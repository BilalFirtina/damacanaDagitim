/**
 * Şema sözleşmesi — migration'lar uygulandıktan sonra kritik nesnelerin
 * gerçekten var olduğunu doğrular. Sadece okuma yapar.
 *
 * CI'de `retention-pg-test.ts --apply-only` sonrasında çalışır.
 */
import { Client } from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

function assertLocalDatabase(url: string) {
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`CI şema testi yalnızca yerel veritabanında çalışır: ${host}`);
  }
}

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}`);
  }
}

async function main() {
  assertLocalDatabase(DATABASE_URL);
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const tables = [
      'users',
      'customers',
      'products',
      'dispatches',
      'dispatch_items',
      'dispatch_reconciliation_items',
      'deliveries',
      'delivery_items',
      'delivery_container_returns',
      'customer_payments',
      'customer_payment_audit',
      'customer_financial_audit',
      'customer_dispensers',
      'suppliers',
      'purchases',
      'purchase_items',
      'purchase_audit',
    ];

    const tableRows = await client.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = any($1::text[])`,
      [tables]
    );
    const existingTables = new Set(tableRows.rows.map((row: any) => row.table_name));
    for (const table of tables) {
      check(`tablo: ${table}`, existingTables.has(table));
    }

    const columns: Array<[string, string]> = [
      ['deliveries', 'stock_override'],
      ['deliveries', 'stock_override_details'],
      ['customer_payments', 'status'],
      ['customer_payments', 'dispatch_id'],
      ['customer_payment_audit', 'request_id'],
      ['purchases', 'status'],
      ['purchase_items', 'quantity'],
      ['purchase_items', 'unit_price'],
      ['customer_dispensers', 'source_delivery_id'],
      ['dispatches', 'collected_empty_sebil'],
    ];
    const columnRows = await client.query(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public'`
    );
    const existingColumns = new Set(
      columnRows.rows.map((row: any) => `${row.table_name}.${row.column_name}`)
    );
    for (const [table, column] of columns) {
      check(`kolon: ${table}.${column}`, existingColumns.has(`${table}.${column}`));
    }

    const functions = [
      'public.apply_delivery(jsonb)',
      'public.close_dispatch(jsonb)',
      'public.record_customer_payment(jsonb)',
      'public.amend_customer_payment(jsonb)',
      'public.admin_update_customer(jsonb)',
      'public.purge_retention(boolean,text[],text[],integer)',
      'public.create_purchase(jsonb)',
      'public.update_purchase(jsonb)',
      'public.cancel_purchase(jsonb)',
    ];
    const functionRows = await client.query(
      `select n.nspname as schema_name, p.oid::regprocedure::text as signature
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'`
    );
    const existingFunctions = new Set(
      functionRows.rows.map((row: any) => `${row.schema_name}.${row.signature}`)
    );
    for (const fn of functions) {
      check(`fonksiyon: ${fn}`, existingFunctions.has(fn));
    }

    const triggers = [
      ['customer_payments', 'trg_customer_payments_no_update_delete'],
      ['customer_payments', 'trg_customer_payments_no_truncate'],
      ['customer_payment_audit', 'trg_customer_payment_audit_no_update_delete'],
      ['customer_payment_audit', 'trg_customer_payment_audit_no_truncate'],
      ['customer_financial_audit', 'trg_customer_financial_audit_no_update_delete'],
    ];
    const triggerRows = await client.query(
      `select c.relname as table_name, t.tgname as trigger_name
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and not t.tgisinternal`
    );
    const existingTriggers = new Set(
      triggerRows.rows.map((row: any) => `${row.table_name}.${row.trigger_name}`)
    );
    for (const [table, trigger] of triggers) {
      check(`trigger: ${table}.${trigger}`, existingTriggers.has(`${table}.${trigger}`));
    }

    const rlsTables = [
      'customer_payments',
      'customer_payment_audit',
      'customer_financial_audit',
      'purchases',
      'purchase_items',
      'purchase_audit',
    ];
    const rlsRows = await client.query(
      `select c.relname as table_name, c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = any($1::text[])`,
      [rlsTables]
    );
    const rlsMap = new Map(rlsRows.rows.map((row: any) => [row.table_name, row.relrowsecurity]));
    for (const table of rlsTables) {
      check(`RLS açık: ${table}`, rlsMap.get(table) === true);
    }
  } finally {
    await client.end();
  }

  console.log(`\nŞema sözleşmesi: ${passed} başarılı, ${failed} başarısız`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Şema sözleşmesi hatası:', error);
  process.exit(1);
});

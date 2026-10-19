-- =============================================================================
-- Salt-okunur şema envanteri (SADECE SEÇME).
-- Bu dosya hiçbir DDL/DML çalıştırmaz. Canlı Supabase/Postgres üzerinde
-- migration uygulamadan önce kolon, kısıt, RLS, yetki ve fonksiyonların
-- gerçek durumunu doğrulamak için kullanılır.
--
-- Kullanım (örnek):
--   psql "$DATABASE_URL" -f scripts/introspect-delivery-rpcs.sql
-- veya Supabase SQL Editor'de tek tek çalıştırın.
-- =============================================================================

\echo '=== 1. Gerekli kolonlar ==='
SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'dispatches' AND column_name IN (
      'id', 'date', 'driver_id', 'driver_name', 'vehicle_plate',
      'loaded_by_user_id', 'loaded_by_user_name', 'driver_confirmed_at',
      'status', 'created_at', 'closed_at', 'closed_by_user_id',
      'closed_by_user_name',
      'total_delivered_value', 'total_cash_collected', 'total_pos_collected',
      'total_credit_added', 'actual_cash_in_pocket', 'actual_pos_slips_total',
      'collected_empty_damacana', 'collected_empty_cam_damacana',
      'collected_empty_tup', 'reconciliation_notes'
    ))
    OR (table_name = 'deliveries' AND column_name IN (
      'id', 'dispatch_id', 'driver_id', 'driver_name', 'vehicle_plate',
      'customer_id', 'customer_name', 'customer_address', 'customer_phone',
      'timestamp', 'delivered_grand_total', 'payment_method', 'cash_amount',
      'pos_amount', 'total_collected', 'diff_uncollected', 'payment_status',
      'notes', 'is_offline_sync'
    ))
    OR (table_name = 'customers' AND column_name IN (
      'id', 'name', 'phone', 'address', 'emails', 'is_account_customer',
      'current_balance_tl', 'notes', 'created_date', 'updated_at'
    ))
    OR (table_name = 'customer_empty_balances' AND column_name IN (
      'customer_id', 'deposit_type', 'quantity', 'updated_at'
    ))
    OR (table_name = 'customer_product_prices' AND column_name IN (
      'customer_id', 'product_id', 'unit_price', 'updated_at'
    ))
    OR (table_name = 'dispatch_items' AND column_name IN (
      'dispatch_id', 'product_id', 'quantity'
    ))
    OR (table_name = 'dispatch_reconciliation_items' AND column_name IN (
      'dispatch_id', 'product_id', 'expected_qty', 'counted_qty'
    ))
    OR (table_name = 'delivery_items' AND column_name IN (
      'delivery_id', 'line_no', 'product_id', 'product_name',
      'quantity', 'unit_price', 'line_total'
    ))
    OR (table_name = 'delivery_container_returns' AND column_name IN (
      'delivery_id', 'deposit_type', 'received_qty', 'diff_qty'
    ))
    OR (table_name = 'dispatch_reopen_audit' AND column_name IN (
      'id', 'dispatch_id', 'reopened_by_user_id', 'reopened_by_user_name',
      'reason', 'reopened_at', 'previous_closed_at', 'previous_reconciliation'
    ))
    OR (table_name = 'dispatch_loading_audit' AND column_name IN (
      'id', 'dispatch_id', 'changed_by_user_id', 'changed_by_user_name',
      'previous_items', 'new_items', 'changed_at'
    ))
    OR (table_name = 'customer_financial_audit' AND column_name IN (
      'id', 'customer_id', 'changed_by_user_id', 'changed_by_user_name',
      'reason', 'previous_balance', 'new_balance', 'previous_empty',
      'new_empty', 'changed_at'
    ))
  )
ORDER BY table_name, ordinal_position;

\echo '=== 2. Tablo/kolon mevcut mu (özet) ==='
SELECT t.table_name,
       COUNT(c.column_name) AS bulunan_kolon
FROM (VALUES
  ('dispatches'), ('deliveries'), ('customers'),
  ('customer_empty_balances'), ('customer_product_prices'),
  ('dispatch_items'), ('dispatch_reconciliation_items'),
  ('delivery_items'), ('delivery_container_returns'),
  ('dispatch_reopen_audit'), ('customer_financial_audit'), ('dispatch_loading_audit')
) AS t(table_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public' AND c.table_name = t.table_name
GROUP BY t.table_name
ORDER BY t.table_name;

\echo '=== 3. PK / UNIQUE / FK kısıtları ==='
SELECT n.nspname AS schema,
       rel.relname AS tablo,
       con.conname AS kisit,
       con.contype AS tur,
       pg_get_constraintdef(con.oid) AS tanim
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname IN (
    'dispatches', 'deliveries', 'customers', 'customer_empty_balances',
    'customer_product_prices', 'dispatch_items',
    'dispatch_reconciliation_items', 'delivery_items',
    'delivery_container_returns', 'dispatch_reopen_audit', 'customer_financial_audit', 'dispatch_loading_audit'
  )
ORDER BY rel.relname, con.contype, con.conname;

\echo '=== 4. İndeksler ==='
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'dispatches', 'deliveries', 'customers', 'customer_empty_balances',
    'customer_product_prices', 'dispatch_items',
    'dispatch_reconciliation_items', 'delivery_items',
    'delivery_container_returns', 'dispatch_reopen_audit', 'customer_financial_audit', 'dispatch_loading_audit'
  )
ORDER BY tablename, indexname;

\echo '=== 5. RLS durumu ve politikalar ==='
SELECT c.relname AS tablo, c.relrowsecurity AS rls_aktif, c.relforcerowsecurity AS rls_zorunlu
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'dispatches', 'deliveries', 'customers', 'customer_empty_balances',
    'customer_product_prices', 'dispatch_items',
    'dispatch_reconciliation_items', 'delivery_items',
    'delivery_container_returns', 'dispatch_reopen_audit', 'customer_financial_audit', 'dispatch_loading_audit'
  )
ORDER BY c.relname;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'dispatches', 'deliveries', 'customers', 'customer_empty_balances',
    'customer_product_prices', 'dispatch_items',
    'dispatch_reconciliation_items', 'delivery_items',
    'delivery_container_returns', 'dispatch_reopen_audit', 'customer_financial_audit', 'dispatch_loading_audit'
  )
ORDER BY tablename, policyname;

\echo '=== 6. Tetikleyiciler (audit immutability) ==='
SELECT n.nspname AS schema,
       c.relname AS tablo,
       t.tgname AS trigger,
       pg_get_triggerdef(t.oid) AS tanim,
       t.tgenabled AS durum
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND c.relname IN ('dispatch_reopen_audit', 'customer_financial_audit', 'dispatch_loading_audit')
ORDER BY c.relname, t.tgname;

\echo '=== 7. Fonksiyonlar, SECURITY ve search_path ==='
SELECT n.nspname AS schema,
       p.proname AS fonksiyon,
       pg_get_function_identity_arguments(p.oid) AS argumanlar,
       CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS guvenlik,
       p.proconfig AS ayarlar,
       pg_get_userbyid(p.proowner) AS sahibi
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'apply_delivery', 'update_dispatch_loading', 'close_dispatch',
    'reopen_dispatch', 'admin_update_customer', 'rpc_authorization_ready',
    'prevent_dispatch_reopen_audit_mutation'
  )
ORDER BY p.proname;

\echo '=== 8. Fonksiyon EXECUTE yetkileri ==='
SELECT routine_schema, routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN (
    'apply_delivery', 'update_dispatch_loading', 'close_dispatch',
    'reopen_dispatch', 'admin_update_customer', 'rpc_authorization_ready',
    'prevent_dispatch_reopen_audit_mutation'
  )
ORDER BY routine_name, grantee;

\echo '=== 9. Tablo yetkileri (audit ve müşteri tabloları) ==='
SELECT table_schema, table_name, grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name IN (
    'dispatch_reopen_audit', 'customer_financial_audit', 'dispatch_loading_audit', 'deliveries', 'dispatches', 'customers',
    'customer_empty_balances', 'customer_product_prices', 'dispatch_items',
    'dispatch_reconciliation_items', 'delivery_items',
    'delivery_container_returns'
  )
ORDER BY table_name, grantee, privilege_type;

\echo '=== 10. Sequence yetkileri (audit id) ==='
SELECT object_schema, object_name, grantee, privilege_type
FROM information_schema.role_usage_grants
WHERE object_schema = 'public'
  AND object_name IN ('dispatch_reopen_audit_id_seq', 'customer_financial_audit_id_seq', 'dispatch_loading_audit_id_seq')
ORDER BY grantee, privilege_type;

\echo '=== 11. Mevcut aktivite: açık seferler ve kapatma tutarlılığı ==='
SELECT d.id,
       d.driver_id,
       d.status,
       d.closed_at,
       COUNT(del.id) AS teslimat_sayisi,
       COALESCE(SUM(del.delivered_grand_total), 0) AS teslimat_toplami,
       d.total_delivered_value
FROM public.dispatches d
LEFT JOIN public.deliveries del ON del.dispatch_id = d.id
WHERE d.status = 'completed'
GROUP BY d.id, d.driver_id, d.status, d.closed_at, d.total_delivered_value
HAVING d.total_delivered_value IS DISTINCT FROM COALESCE(SUM(del.delivered_grand_total), 0)
ORDER BY d.id
LIMIT 100;

\echo '=== 12. Başka bir şoförün aktif seferi var mı? ==='
SELECT driver_id, COUNT(*) AS aktif_sefer
FROM public.dispatches
WHERE status <> 'completed'
GROUP BY driver_id
HAVING COUNT(*) > 1
ORDER BY driver_id;

\echo '=== 13. Eski audit FK'si kalmış mı? ==='
SELECT conname, pg_get_constraintdef(oid) AS tanim
FROM pg_constraint
WHERE conrelid = to_regclass('public.dispatch_reopen_audit')
  AND contype = 'f';

\echo '=== 14. RPC yetki sertleştirmesi hazır mı? ==='
SELECT
  to_regprocedure('public.rpc_authorization_ready()') IS NOT NULL AS denetim_fonksiyonu_var,
  has_function_privilege('anon', 'public.apply_delivery(jsonb)', 'EXECUTE') AS anon_apply_delivery,
  has_function_privilege('authenticated', 'public.apply_delivery(jsonb)', 'EXECUTE') AS auth_apply_delivery,
  has_function_privilege('service_role', 'public.apply_delivery(jsonb)', 'EXECUTE') AS service_apply_delivery,
  has_table_privilege('anon', 'public.deliveries', 'INSERT') AS anon_delivery_insert,
  has_table_privilege('service_role', 'public.deliveries', 'INSERT') AS service_delivery_insert;

\echo '=== 15. Kapatmaya hazır olmayan açık seferler ==='
SELECT d.id,
       d.status,
       d.closed_at,
       COUNT(del.id) AS teslimat_sayisi,
       COUNT(del.id) FILTER (
         WHERE NOT EXISTS (
           SELECT 1 FROM public.delivery_items di WHERE di.delivery_id = del.id
         )
       ) AS kalemsiz_teslimat,
       COUNT(del.id) FILTER (
         WHERE abs(COALESCE(del.total_collected, 0)
                   - COALESCE(del.cash_amount, 0)
                   - COALESCE(del.pos_amount, 0)) > 0.01
            OR abs(COALESCE(del.total_collected, 0)
                   + COALESCE(del.diff_uncollected, 0)
                   - COALESCE(del.delivered_grand_total, 0)) > 0.01
       ) AS odeme_tutarsiz_teslimat
FROM public.dispatches d
LEFT JOIN public.deliveries del ON del.dispatch_id = d.id
WHERE d.status = 'in_transit'
GROUP BY d.id, d.status, d.closed_at
HAVING COUNT(del.id) FILTER (
         WHERE NOT EXISTS (
           SELECT 1 FROM public.delivery_items di WHERE di.delivery_id = del.id
         )
       ) > 0
    OR COUNT(del.id) FILTER (
         WHERE abs(COALESCE(del.total_collected, 0)
                   - COALESCE(del.cash_amount, 0)
                   - COALESCE(del.pos_amount, 0)) > 0.01
            OR abs(COALESCE(del.total_collected, 0)
                   + COALESCE(del.diff_uncollected, 0)
                   - COALESCE(del.delivered_grand_total, 0)) > 0.01
       ) > 0
ORDER BY d.id
LIMIT 100;

\echo '=== 16. Aynı plakada birden fazla aktif sefer ==='
SELECT vehicle_plate, COUNT(*) AS aktif_sefer
FROM public.dispatches
WHERE status IN ('pending_confirmation', 'in_transit')
GROUP BY vehicle_plate
HAVING COUNT(*) > 1
ORDER BY vehicle_plate;

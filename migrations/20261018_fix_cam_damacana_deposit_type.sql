-- =============================================================================
-- Migration: Fix cam_damacana deposit classification
-- Date: 2026-10-18
-- Target: Supabase project (public.products)
--
-- Problem:
--   The product row `prod_cam_damacana` ("Hayat Cam Damacana") had
--   deposit_type = 'damacana'. It must be 'cam_damacana' so that glass
--   damacana deposits and returns are tracked separately from ordinary
--   plastic damacana deposits and returns.
--
--   The seed block in supabase_schema.sql declares the correct value, but its
--   ON CONFLICT (id) DO UPDATE only refreshes `name` and `default_unit_price`,
--   so re-seeding never repairs `deposit_type`.
--
-- Impact:
--   Affects ONLY future deliveries. Historical deliveries store their empty
--   container counts as snapshots and do not re-derive classification, so no
--   historical data correction is required (verified: no delivery or dispatch
--   referenced `prod_cam_damacana`; all customers had
--   empty_deposit_cam_damacana = 0 at migration time).
--
-- Safety / idempotency:
--   - Drops any existing CHECK constraint on products.deposit_type first, then
--     re-creates `products_deposit_type_check` preserving ALL existing allowed
--     values: 'damacana', 'cam_damacana', 'tup', 'none'.
--   - Updates only the single target row, and only when its value differs.
--   - Non-destructive; safe to run more than once. Allowed values are never
--     reduced.
--
-- How to apply:
--   Supabase Dashboard -> SQL Editor -> paste this file -> Run.
--   (Already applied manually by the operator; kept here for reproducibility.)
-- =============================================================================

BEGIN;

-- 1. Ensure the deposit_type CHECK constraint allows 'cam_damacana'.
--    Drop any existing CHECK constraint that covers products.deposit_type,
--    then re-create it with the full allowed value set.
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute att
      ON att.attrelid = c.conrelid
     AND att.attnum = ANY (c.conkey)
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'products'
      AND c.contype = 'c'
      AND att.attname = 'deposit_type'
  LOOP
    EXECUTE format('ALTER TABLE public.products DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

-- 2. Normalize the cam damacana classification (idempotent).
UPDATE public.products
SET deposit_type = 'cam_damacana'
WHERE id = 'prod_cam_damacana'
  AND deposit_type <> 'cam_damacana';

-- 3. Re-create the CHECK constraint with every allowed value preserved.
ALTER TABLE public.products
  ADD CONSTRAINT products_deposit_type_check
  CHECK (deposit_type IN ('damacana', 'cam_damacana', 'tup', 'none'));

COMMIT;

-- -----------------------------------------------------------------------------
-- Verification (run after the transaction):
-- -----------------------------------------------------------------------------
-- SELECT id, name, category, deposit_type, unit
-- FROM public.products
-- WHERE id = 'prod_cam_damacana';
-- Expected: deposit_type = 'cam_damacana'
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conname = 'products_deposit_type_check';
-- Expected: CHECK (deposit_type = ANY (ARRAY['damacana','cam_damacana','tup','none']))

-- -----------------------------------------------------------------------------
-- Rollback (only if the change must be reverted; re-adds the full value set):
-- -----------------------------------------------------------------------------
-- BEGIN;
-- UPDATE public.products
-- SET deposit_type = 'damacana'
-- WHERE id = 'prod_cam_damacana';
-- COMMIT;

-- =============================================================================
-- 20261125 — Yakıt yüklemesi ve araç yakıt alımları
--
-- * credit   : Yöneticinin genel yakıt yüklemesi; ortak bakiyeyi artırır.
-- * purchase : Araç yakıt alımı; ortak bakiyeyi düşürür ve grafiğe girer.
--
-- Denetim/düzeltme kaydı yoktur. İptal, kaydı fiziksel olarak siler.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.fuel_entries (
  id TEXT PRIMARY KEY,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('credit', 'purchase')),
  plate TEXT NULL,
  entry_date TEXT NOT NULL CHECK (entry_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  liters NUMERIC(10, 2) NOT NULL CHECK (liters > 0),
  amount_tl NUMERIC(12, 2) NULL CHECK (amount_tl IS NULL OR amount_tl > 0),
  mileage_km INTEGER NULL CHECK (mileage_km IS NULL OR mileage_km > 0),
  note TEXT NULL,
  created_by_user_id TEXT NOT NULL,
  created_by_user_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fuel_entries_shape_check CHECK (
    (
      entry_type = 'credit'
      AND plate IS NULL
      AND mileage_km IS NULL
    )
    OR
    (
      entry_type = 'purchase'
      AND plate IS NOT NULL
      AND btrim(plate) <> ''
      AND mileage_km IS NOT NULL
      AND amount_tl IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_fuel_entries_date
  ON public.fuel_entries (entry_date, created_at);

CREATE INDEX IF NOT EXISTS idx_fuel_entries_plate_mileage
  ON public.fuel_entries (plate, mileage_km);

CREATE UNIQUE INDEX IF NOT EXISTS ux_fuel_entries_plate_mileage
  ON public.fuel_entries (plate, mileage_km)
  WHERE entry_type = 'purchase';

-- Araç yakıt alımında kilometre, aynı plakanın son kaydından büyük olmalıdır.
CREATE OR REPLACE FUNCTION public.enforce_fuel_mileage_increasing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_last_km INTEGER;
BEGIN
  IF NEW.entry_type <> 'purchase' THEN
    RETURN NEW;
  END IF;

  SELECT MAX(mileage_km) INTO v_last_km
  FROM public.fuel_entries
  WHERE entry_type = 'purchase'
    AND plate = NEW.plate;

  IF v_last_km IS NOT NULL AND NEW.mileage_km <= v_last_km THEN
    RAISE EXCEPTION 'MILEAGE_NOT_INCREASING:%', v_last_km;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fuel_entries_mileage_increasing ON public.fuel_entries;
CREATE TRIGGER trg_fuel_entries_mileage_increasing
  BEFORE INSERT ON public.fuel_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fuel_mileage_increasing();

ALTER TABLE public.fuel_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.fuel_entries FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.fuel_entries FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.fuel_entries FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, DELETE ON public.fuel_entries TO service_role';
  END IF;
END $$;

COMMIT;

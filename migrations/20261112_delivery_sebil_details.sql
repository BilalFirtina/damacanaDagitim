-- =============================================================================
-- 20261112 — Teslimat sebil iadesi serbest metin detayları
--
-- * Şoförün sebil iadesi sırasında girdiği marka/model/açıklama bilgisi.
-- * Marka/model sistemde kayıtlı değerlerle eşleştirilmez.
-- * Yalnızca kayıt/denetim amaçlıdır; raporlarda adet ve müşteri adı gösterilir.
-- * Nullable ve geriye dönük uyumludur; mevcut satırlar etkilenmez.
-- * Teslimat silinince satır da silinir (ON DELETE CASCADE).
-- =============================================================================

ALTER TABLE public.delivery_container_returns
  ADD COLUMN IF NOT EXISTS sebil_details JSONB NULL;

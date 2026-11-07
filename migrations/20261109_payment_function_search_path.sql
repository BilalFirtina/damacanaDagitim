-- =============================================================================
-- ÖDEME FONKSİYONLARINDA search_path SABİTLEME
--
-- Supabase güvenlik uyarısı: fonksiyonların rol tarafından değiştirilebilir
-- search_path değeri, arama yolu üzerinden yetkisiz nesne çözümlemesine yol
-- açabilir. Fonksiyon gövdeleri değişmez; yalnızca search_path sabitlenir.
-- =============================================================================

ALTER FUNCTION public.record_customer_payment(jsonb)
  SET search_path = public;

ALTER FUNCTION public.prevent_customer_payment_mutation()
  SET search_path = public;

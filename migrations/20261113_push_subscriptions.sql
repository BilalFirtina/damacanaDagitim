-- =============================================================================
-- 20261113 — Web Push bildirim abonelikleri
--
-- * Yalnızca yeni bir tablo ekler; mevcut tablo, satır ve politikaları değiştirmez.
-- * Abonelikler cihaz bazlıdır: aynı kullanıcı birden fazla cihazdan abone olabilir.
-- * 60 günlük günlük hareket temizliğinden etkilenmez; cihaz ayarı olarak kalır.
-- * Kullanıcı silinirse abonelikleri de silinir (ON DELETE CASCADE).
-- * İstemci bu tabloya doğrudan erişemez; yazma/okuma yalnızca sunucu tarafındadır.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_push_subscriptions_user_id
  ON public.push_subscriptions(user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Abonelik uçları yalnızca sunucunun ayrıcalıklı bağlantısıyla yönetilir.
REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

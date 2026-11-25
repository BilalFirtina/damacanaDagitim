// Uygulama genelindeki API polling aralığı.
// Supabase egress ve log üretimini azaltmak için 8 sn yerine 15 sn kullanılır.
export const POLL_INTERVAL_MS = 15_000;

// Yakıt sekmesi listesi daha seyrek yenilenir.
export const FUEL_POLL_INTERVAL_MS = 30_000;

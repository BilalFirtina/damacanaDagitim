export type SupabaseKeyKind = 'privileged' | 'publishable' | 'unknown';

const PRIVILEGED_ROLES = new Set(['service_role', 'supabase_admin']);

export function decodeJwtPayload(key: string): Record<string, unknown> | null {
  const parts = String(key || '').trim().split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function classifySupabaseKey(key: string): SupabaseKeyKind {
  const trimmed = String(key || '').trim();
  if (!trimmed) return 'unknown';

  if (trimmed.startsWith('sb_secret_')) return 'privileged';
  if (trimmed.startsWith('sb_publishable_')) return 'publishable';

  const payload = decodeJwtPayload(trimmed);
  const role = typeof payload?.role === 'string' ? payload.role : null;
  if (role && PRIVILEGED_ROLES.has(role)) return 'privileged';
  if (role === 'anon' || role === 'authenticated') return 'publishable';
  return 'unknown';
}

export function isPrivilegedSupabaseKey(key: string): boolean {
  return classifySupabaseKey(key) === 'privileged';
}

export const RPC_AUTH_UNAVAILABLE_MESSAGE =
  'Güvenli sunucu veritabanı yetkisi yapılandırılmadığı için işlem reddedildi. ' +
  'Sunucuda yalnızca hizmet rolü anahtarı kullanılmalı ve RPC yetki sertleştirme migration uygulanmalıdır.';

export const RPC_HARDENING_MISSING_MESSAGE =
  'Veritabanı yetki sertleştirmesi eksik. Anon/authenticated RPC erişimi kapatılmadan işlem yapılamaz.';

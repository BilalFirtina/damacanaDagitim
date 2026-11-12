import dotenv from 'dotenv';
import { sendNotification, setVapidDetails } from 'web-push';
import {
  deletePushSubscriptionByEndpoint,
  getPushSubscriptions,
} from './db.ts';

dotenv.config();

const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = (
  process.env.VAPID_SUBJECT || 'https://damacanadagitim.onrender.com'
).trim();

let pushConfigured = false;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    pushConfigured = true;
  } catch (err) {
    console.error('[Push] VAPID yapılandırması geçersiz:', err);
  }
} else {
  console.warn(
    '[Push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY tanımlı değil; Web Push bildirimleri devre dışı.'
  );
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

export interface PushSendResult {
  sent: number;
  failed: number;
  removed: number;
}

export function isPushConfigured(): boolean {
  return pushConfigured;
}

export function getPushPublicKey(): string | null {
  return pushConfigured ? VAPID_PUBLIC_KEY : null;
}

/**
 * Tüm kayıtlı cihazlara bildirim gönderir.
 * - 404/410 dönen ölü abonelikler tablodan temizlenir.
 * - Tek bir cihaz hatası diğer cihazları etkilemez.
 * - Bu fonksiyon çağıran isteği asla bloklamamalıdır; sunucu tarafında
 *   `setImmediate` ile arka planda çağrılır.
 */
export async function sendPushToAllUsers(payload: PushPayload): Promise<PushSendResult> {
  const result: PushSendResult = { sent: 0, failed: 0, removed: 0 };
  if (!pushConfigured) return result;

  let subscriptions;
  try {
    subscriptions = await getPushSubscriptions();
  } catch (err) {
    console.error('[Push] Abonelikler okunamadı:', err);
    return result;
  }

  if (subscriptions.length === 0) return result;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/?tab=team_feed',
    tag: payload.tag,
  });

  await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      try {
        await sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          body,
          {
            TTL: 60 * 60,
            urgency: 'high',
            timeout: 8000,
          }
        );
        result.sent += 1;
      } catch (err: any) {
        const statusCode = Number(err?.statusCode) || 0;
        if (statusCode === 404 || statusCode === 410) {
          result.removed += 1;
          try {
            await deletePushSubscriptionByEndpoint(subscription.endpoint);
          } catch (deleteErr) {
            console.error('[Push] Ölü abonelik silinemedi:', deleteErr);
          }
          return;
        }
        result.failed += 1;
        console.warn(
          `[Push] Gönderim başarısız (HTTP ${statusCode || 'bilinmiyor'}):`,
          err?.body || err?.message || err
        );
      }
    })
  );

  return result;
}

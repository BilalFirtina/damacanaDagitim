import { useCallback, useEffect, useRef, useState } from 'react';
import { User } from '../types';
import { fetchPushConfig, subscribePush, unsubscribePush } from '../services/api';

export type PushStatus =
  | 'checking'
  | 'supported'
  | 'unsupported'
  | 'ios_not_installed'
  | 'denied'
  | 'insecure'
  | 'not_configured';

interface UsePushNotificationsResult {
  enabled: boolean;
  busy: boolean;
  status: PushStatus;
  message: string | null;
  toggle: () => Promise<void>;
  disable: (options?: { server?: boolean }) => Promise<void>;
}

function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua) && !(window as any).MSStream;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// Bildirim ayarları yalnızca mobil görünümde yönetilir. 768px ve üzerinde
// hook hiçbir abonelik/izin işlemi yapmaz; mevcut ayarlara dokunmaz.
function isDesktopViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(min-width: 768px)').matches;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Geliştirme modunda service worker bilinçli olarak kaydedilmez; bu durumda
// `navigator.serviceWorker.ready` sonsuza kadar bekler. Kullanıcıya takılı
// spinner göstermemek için kısa bir zaman aşımı kullanılır.
function waitForServiceWorker(ms = 8000): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ms)),
  ]);
}

export function usePushNotifications(currentUser: User | null): UsePushNotificationsResult {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<PushStatus>('checking');
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const messageTimer = useRef<number | null>(null);
  const [isDesktop, setIsDesktop] = useState<boolean>(() => isDesktopViewport());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(min-width: 768px)');
    const onChange = () => setIsDesktop(media.matches);
    onChange();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  const showMessage = useCallback((text: string) => {
    setMessage(text);
    if (messageTimer.current) window.clearTimeout(messageTimer.current);
    messageTimer.current = window.setTimeout(() => setMessage(null), 6000);
  }, []);

  useEffect(
    () => () => {
      if (messageTimer.current) window.clearTimeout(messageTimer.current);
    },
    []
  );

  // Ortam, izin ve mevcut abonelik durumunu kontrol et.
  useEffect(() => {
    let cancelled = false;
    setEnabled(false);
    setMessage(null);
    setPublicKey(null);

    if (!currentUser) {
      setStatus('checking');
      return () => {
        cancelled = true;
      };
    }

    if (isDesktop) {
      setStatus('checking');
      return () => {
        cancelled = true;
      };
    }

    if (!window.isSecureContext) {
      setStatus('insecure');
      return () => {
        cancelled = true;
      };
    }

    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setStatus('unsupported');
      return () => {
        cancelled = true;
      };
    }

    // iOS/iPadOS'ta web push yalnızca Ana Ekrana eklenmiş uygulamada çalışır.
    if (isIOSDevice() && !isStandalone()) {
      setStatus('ios_not_installed');
      return () => {
        cancelled = true;
      };
    }

    if (Notification.permission === 'denied') {
      setStatus('denied');
      return () => {
        cancelled = true;
      };
    }

    setStatus('checking');

    void (async () => {
      let config;
      try {
        config = await fetchPushConfig();
      } catch (err) {
        console.warn('[Push] Bildirim yapılandırması alınamadı:', err);
        if (!cancelled) setStatus('not_configured');
        return;
      }

      if (cancelled) return;

      if (!config.enabled || !config.publicKey) {
        setStatus('not_configured');
        return;
      }

      setPublicKey(config.publicKey);
      setStatus('supported');

      if (Notification.permission !== 'granted') return;

      // Mevcut abonelik varsa giriş yapan kullanıcıya yeniden bağla.
      // Eşitleme başarısız olsa bile zil açık kalır; kullanıcı tekrar deneyebilir.
      try {
        const registration = await navigator.serviceWorker.getRegistration('/');
        if (!registration) return;

        const existing = await registration.pushManager.getSubscription();
        if (!existing) return;

        const json = existing.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

        await subscribePush({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        });
        if (!cancelled) setEnabled(true);
      } catch (err) {
        console.warn('[Push] Mevcut abonelik eşitlenemedi:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, isDesktop]);

  const enable = useCallback(async () => {
    if (!currentUser || isDesktop) return;

    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setStatus('unsupported');
      showMessage('Bu cihazda bildirim desteklenmiyor.');
      return;
    }

    if (isIOSDevice() && !isStandalone()) {
      setStatus('ios_not_installed');
      showMessage('iPhone’da bildirim için uygulamayı Ana Ekrana ekleyin.');
      return;
    }

    if (!publicKey) {
      showMessage('Bildirim altyapısı henüz yapılandırılmadı. Yöneticiye bildirin.');
      return;
    }

    setBusy(true);
    try {
      // İzin isteği kullanıcı tıklamasıyla aynı görevde başlatılmalıdır.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus('denied');
        showMessage('Bildirim izni verilmedi. Tarayıcı ayarlarından izin verebilirsiniz.');
        return;
      }

      const registration = await waitForServiceWorker();
      if (!registration) {
        showMessage('Bildirim servisi hazır değil. Sayfayı yenileyip tekrar deneyin.');
        return;
      }

      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        });
      }

      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error('Bildirim aboneliği anahtarları eksik.');
      }

      await subscribePush({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });

      setEnabled(true);
      setStatus('supported');
      showMessage('Bildirimler açıldı.');
    } catch (err: any) {
      console.error('[Push] Bildirimler açılamadı:', err);
      showMessage(err?.message || 'Bildirimler açılamadı. Lütfen tekrar deneyin.');
    } finally {
      setBusy(false);
    }
  }, [currentUser, publicKey, showMessage, isDesktop]);

  const disable = useCallback(
    async (options?: { server?: boolean }) => {
      if (isDesktop) {
        setEnabled(false);
        setBusy(false);
        return;
      }

      setBusy(true);
      try {
        const registration =
          'serviceWorker' in navigator
            ? await navigator.serviceWorker.getRegistration('/')
            : null;
        const subscription = registration
          ? await registration.pushManager.getSubscription()
          : null;

        if (subscription) {
          if (options?.server !== false) {
            try {
              // Çıkış işlemi ağ hatası yüzünden kilitlenmesin.
              await Promise.race([
                unsubscribePush(subscription.endpoint),
                new Promise<never>((_, reject) =>
                  window.setTimeout(
                    () => reject(new Error('Bildirim aboneliği zaman aşımına uğradı.')),
                    5000
                  )
                ),
              ]);
            } catch (err) {
              console.warn('[Push] Sunucu aboneliği kaldırılamadı:', err);
            }
          }
          await subscription.unsubscribe();
        }

        setEnabled(false);
        if (options?.server !== false) showMessage('Bildirimler kapatıldı.');
      } catch (err) {
        console.error('[Push] Bildirimler kapatılamadı:', err);
        if (options?.server !== false) showMessage('Bildirimler kapatılamadı.');
      } finally {
        setBusy(false);
      }
    },
    [showMessage, isDesktop]
  );

  const toggle = useCallback(async () => {
    if (busy || isDesktop) return;
    if (enabled) {
      await disable();
    } else {
      await enable();
    }
  }, [busy, enabled, disable, enable, isDesktop]);

  return { enabled, busy, status, message, toggle, disable };
}

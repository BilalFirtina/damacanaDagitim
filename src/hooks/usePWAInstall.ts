import { useEffect, useState, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() => {
    return (window as any).__PWA_PROMPT__ || null;
  });
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      (window as any).__PWA_INSTALLED__ ||
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      document.referrer.includes('android-app://')
    );
  });
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Check if app is opened in standalone/installed mode
    const checkIsInstalled = () => {
      const isStandalone =
        (window as any).__PWA_INSTALLED__ ||
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
        document.referrer.includes('android-app://');
      setIsInstalled(isStandalone);
    };

    checkIsInstalled();

    // Detect iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent) && !(window as any).MSStream;
    setIsIOS(isIOSDevice);

    // If early prompt was caught in index.html, load it
    if ((window as any).__PWA_PROMPT__) {
      setDeferredPrompt((window as any).__PWA_PROMPT__);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      (window as any).__PWA_PROMPT__ = e as BeforeInstallPromptEvent;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handlePromptReady = () => {
      if ((window as any).__PWA_PROMPT__) {
        setDeferredPrompt((window as any).__PWA_PROMPT__);
      }
    };

    const handleAppInstalled = () => {
      (window as any).__PWA_INSTALLED__ = true;
      (window as any).__PWA_PROMPT__ = null;
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('pwa_prompt_ready', handlePromptReady);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('pwa_installed', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('pwa_prompt_ready', handlePromptReady);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('pwa_installed', handleAppInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unsupported'> => {
    const promptEvent = deferredPrompt || (window as any).__PWA_PROMPT__;
    if (promptEvent && typeof promptEvent.prompt === 'function') {
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice && choice.outcome === 'accepted') {
          setIsInstalled(true);
          setDeferredPrompt(null);
          (window as any).__PWA_PROMPT__ = null;
          return 'accepted';
        }
        return 'dismissed';
      } catch (err) {
        console.error('PWA install prompt error:', err);
      }
    }

    return 'unsupported';
  }, [deferredPrompt]);

  const openApp = useCallback(() => {
    window.location.href = '/';
  }, []);

  return {
    isInstallable: !!(deferredPrompt || (window as any).__PWA_PROMPT__),
    isInstalled,
    isIOS,
    install,
    openApp,
  };
}

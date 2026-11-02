import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Register Service Worker for PWA installability and offline support.
// In development we deliberately DO NOT register a service worker: the SW would
// cache Vite source modules (/src/*.tsx) and serve stale client code.
function unregisterServiceWorkers() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => regs.forEach((reg) => reg.unregister()))
    .catch(() => {});
  if ('caches' in window) {
    caches
      .keys()
      .then((keys) => keys.forEach((key) => caches.delete(key)))
      .catch(() => {});
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  if (import.meta.env.DEV) {
    unregisterServiceWorkers();
    return;
  }

  if (
    window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  ) {
    // Sayfa yüklenirken zaten bir servis çalışanı kontrolü varsa, bundan sonraki
    // controllerchange gerçek bir GÜNCELLEMEdir. İlk kurulumda clients.claim()
    // de bu olayı tetiklediği için bu ayrım şart (AGENTS.md Bölüm 12.2).
    const hadController = !!navigator.serviceWorker.controller;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      window.dispatchEvent(new CustomEvent('app:update-ready'));
    });

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        console.log('[PWA] Service Worker registered with scope:', reg.scope);
      })
      .catch((err) => {
        console.warn('[PWA] Service Worker registration failed:', err);
      });
  }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  registerServiceWorker();
} else {
  window.addEventListener('load', registerServiceWorker);
}

createRoot(document.getElementById('root')!).render(<App />);

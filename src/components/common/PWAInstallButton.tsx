import React from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Download } from 'lucide-react';

interface PWAInstallButtonProps {
  className?: string;
  variant?: 'primary' | 'header';
}

const REMEMBERED_USER_KEY = 'sudagitim_remembered_user';
const SESSION_USER_KEY = 'sudagitim_session_user';

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ className = '', variant = 'primary' }) => {
  const { isInstalled, isInstallable, install, openApp } = usePWAInstall();

  // 1. Strict Requirement: Do NOT show the button if the PWA is already installed or running in standalone mode
  if (isInstalled) {
    return null;
  }

  // 2. Strict Requirement: Do NOT show the button if user is authenticated
  if (typeof window !== 'undefined') {
    const hasAuth = !!(localStorage.getItem(REMEMBERED_USER_KEY) || sessionStorage.getItem(SESSION_USER_KEY));
    if (hasAuth) {
      return null;
    }
  }

  const handleClick = async () => {
    // 1. If native install prompt is available, trigger the native installation prompt
    if (isInstallable || (window as any).__PWA_PROMPT__) {
      await install();
      return;
    }

    // 2. If app was previously installed and user is in browser, open the app
    if (isInstalled) {
      openApp();
      return;
    }

    // 3. If in an iframe (e.g. preview environment), open top-level without showing any dialog
    if (window.self !== window.top) {
      try {
        window.top?.location?.assign(window.location.href);
      } catch {
        // Sandboxed iframe; silently continue without throwing or displaying errors
      }
      return;
    }

    // 4. On platforms without programmatic installation support, do not display warnings or popups
    // Per instructions: strictly avoid triggering unsupported actions or error dialogs.
  };

  const isHeader = variant === 'header';

  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        className ||
        (isHeader
          ? 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-sky-600 text-white text-xs font-bold shadow-md shadow-sky-600/20 hover:from-emerald-700 hover:to-sky-700 active:scale-95 transition-all cursor-pointer whitespace-nowrap'
          : 'inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-sky-600 px-4 py-2.5 sm:px-5 sm:py-3 text-xs font-black text-white shadow-lg shadow-sky-600/30 hover:from-emerald-700 hover:to-sky-700 active:scale-95 transition-all whitespace-nowrap shrink-0 cursor-pointer')
      }
      title="Uygulamayı Telefona İndir"
    >
      <Download className="w-4 h-4 animate-bounce shrink-0" />
      <span>Uygulamayı Telefona İndir</span>
    </button>
  );
};

import React from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Download, Check } from 'lucide-react';

interface PWAInstallButtonProps {
  className?: string;
  variant?: 'primary' | 'header';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ className = '', variant = 'primary' }) => {
  const { isInstalled, isInstallable, install, openApp } = usePWAInstall();

  // If already running in standalone/installed mode, show that it is installed
  if (isInstalled) {
    return (
      <button
        type="button"
        onClick={openApp}
        className={`inline-flex items-center gap-2 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3.5 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-300 shadow-xs cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors ${className}`}
        title="Uygulama telefonunuzda kurulu modda. Dokunarak açabilirsiniz."
      >
        <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span>Uygulama Yüklü</span>
      </button>
    );
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

import React from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Download } from 'lucide-react';

export const PWAInstallButton: React.FC = () => {
  const { isInstalled, install } = usePWAInstall();

  // If already running as an installed PWA, hide the button
  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    await install();
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-sky-600 px-4 py-2 sm:px-5 sm:py-3 text-xs font-black text-white shadow-lg shadow-sky-600/30 hover:from-emerald-700 hover:to-sky-700 active:scale-95 transition-all whitespace-nowrap shrink-0"
      title="Uygulamayı Telefonunuza / Ana Ekranınıza Kurun"
    >
      <Download className="w-4 h-4 animate-bounce" />
      <span>Uygulamayı Telefona İndir</span>
    </button>
  );
};


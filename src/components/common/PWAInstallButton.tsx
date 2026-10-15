import React from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Download, ExternalLink } from 'lucide-react';

export const PWAInstallButton: React.FC = () => {
  const { isInstalled, isInstallable, install } = usePWAInstall();

  const handleClick = async () => {
    if (isInstalled) {
      // Zaten yüklüyse doğrudan uygulamaya yönlendir
      window.location.href = '/';
      return;
    }

    try {
      await install();
    } catch {
      // Hata veya uyarı gösterilmez, sessizce geçilir
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-sky-600 px-4 py-2 sm:px-5 sm:py-3 text-xs font-black text-white shadow-lg shadow-sky-600/30 hover:from-emerald-700 hover:to-sky-700 active:scale-95 transition-all whitespace-nowrap shrink-0 cursor-pointer"
      title={isInstalled ? 'Uygulamayı Aç' : 'Uygulamayı Telefona İndir'}
    >
      {isInstalled ? (
        <>
          <ExternalLink className="w-4 h-4" />
          <span>Uygulamayı Aç</span>
        </>
      ) : (
        <>
          <Download className="w-4 h-4 animate-bounce" />
          <span>Uygulamayı Telefona İndir</span>
        </>
      )}
    </button>
  );
};



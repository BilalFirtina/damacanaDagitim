import React, { useState } from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Download, AlertCircle, X } from 'lucide-react';

export const PWAInstallButton: React.FC = () => {
  const { isInstalled, install } = usePWAInstall();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // If already running as an installed standalone app, do not show button
  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    setErrorMessage(null);
    const result = await install();

    if (result === 'ios') {
      setErrorMessage(
        'iPhone / iPad Safari tarayıcısında uygulamayı yüklemek için: Ekranın altındaki "Paylaş" (kare içinde yukarı ok) butonuna basıp ardından "Ana Ekrana Ekle" seçeneğini seçiniz.'
      );
    } else if (result === 'unsupported') {
      setErrorMessage(
        'Tarayıcınız doğrudan yükleme komutunu henüz tetikleyemedi. Lütfen tarayıcınızın sağ üstündeki (⋮) menüsüne dokunup "Uygulamayı Yükle" veya "Ana Ekrana Ekle" seçeneğini seçiniz.'
      );
    }
  };

  return (
    <div className="w-full flex flex-col items-center">
      <button
        onClick={handleClick}
        className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-sky-600 px-4 py-2 sm:px-5 sm:py-3 text-xs font-black text-white shadow-lg shadow-sky-600/30 hover:from-emerald-700 hover:to-sky-700 active:scale-95 transition-all whitespace-nowrap shrink-0 cursor-pointer"
        title="Uygulamayı Telefonunuza / Ana Ekranınıza Kurun"
      >
        <Download className="w-4 h-4 animate-bounce" />
        <span>Uygulamayı Telefona İndir</span>
      </button>

      {errorMessage && (
        <div className="mt-2.5 max-w-sm w-full p-3 bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 rounded-xl text-amber-900 dark:text-amber-200 text-xs text-left shadow-md flex items-start gap-2 relative">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 pr-4 leading-relaxed font-medium">
            {errorMessage}
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="absolute top-2 right-2 text-amber-700 hover:text-amber-950 dark:text-amber-300"
            title="Kapat"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};



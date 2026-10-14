import React, { useState } from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Download, Smartphone, X } from 'lucide-react';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  // If already running as an installed PWA, hide the button
  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className="flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-bold text-white shadow-md shadow-sky-600/20 hover:bg-sky-700 active:scale-95 transition-all whitespace-nowrap shrink-0"
        title="Uygulamayı Telefonunuza / Bilgisayarınıza Kurun"
      >
        <Download className="w-4 h-4 animate-bounce" />
        <span>Uygulamayı İndir</span>
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-left">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-sky-100 dark:bg-sky-950/60 text-sky-600 flex items-center justify-center">
                  <Smartphone className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Uygulama Kurulumu</h3>
              </div>
              <button
                onClick={() => setShowGuide(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-xs sm:text-sm text-slate-600 dark:text-slate-300">
              {isIOS ? (
                <>
                  <p className="flex items-start gap-2.5">
                    <span className="font-bold text-sky-600 bg-sky-50 dark:bg-sky-950/50 w-5 h-5 rounded-full flex items-center justify-center shrink-0">1</span>
                    <span>Safari tarayıcısının alt menüsündeki <strong className="text-slate-900 dark:text-white">Paylaş</strong> (kare ve yukarı ok) simgesine dokunun.</span>
                  </p>
                  <p className="flex items-start gap-2.5">
                    <span className="font-bold text-sky-600 bg-sky-50 dark:bg-sky-950/50 w-5 h-5 rounded-full flex items-center justify-center shrink-0">2</span>
                    <span>Açılan menüde aşağı kaydırıp <strong className="text-slate-900 dark:text-white">"Ana Ekrana Ekle"</strong> seçeneğini seçin.</span>
                  </p>
                  <p className="flex items-start gap-2.5">
                    <span className="font-bold text-sky-600 bg-sky-50 dark:bg-sky-950/50 w-5 h-5 rounded-full flex items-center justify-center shrink-0">3</span>
                    <span>Sağ üst köşedeki <strong className="text-slate-900 dark:text-white">"Ekle"</strong> butonuna dokunarak telefonunuza yükleyin.</span>
                  </p>
                </>
              ) : (
                <>
                  <p className="flex items-start gap-2.5">
                    <span className="font-bold text-sky-600 bg-sky-50 dark:bg-sky-950/50 w-5 h-5 rounded-full flex items-center justify-center shrink-0">1</span>
                    <span>Tarayıcınızın sağ üst köşesindeki <strong className="text-slate-900 dark:text-white">Menü (3 nokta)</strong> simgesine dokunun.</span>
                  </p>
                  <p className="flex items-start gap-2.5">
                    <span className="font-bold text-sky-600 bg-sky-50 dark:bg-sky-950/50 w-5 h-5 rounded-full flex items-center justify-center shrink-0">2</span>
                    <span><strong className="text-slate-900 dark:text-white">"Uygulamayı Yükle"</strong> veya <strong className="text-slate-900 dark:text-white">"Ana Ekrana Ekle"</strong> seçeneğini seçin.</span>
                  </p>
                  <p className="flex items-start gap-2.5">
                    <span className="font-bold text-sky-600 bg-sky-50 dark:bg-sky-950/50 w-5 h-5 rounded-full flex items-center justify-center shrink-0">3</span>
                    <span>Onaylayarak uygulamayı telefonunuzun ana ekranına hızlı erişim olarak ekleyin.</span>
                  </p>
                </>
              )}
            </div>

            <div className="mt-6">
              <button
                onClick={() => setShowGuide(false)}
                className="w-full rounded-xl bg-sky-600 py-3 text-sm font-semibold text-white hover:bg-sky-700 shadow-lg shadow-sky-600/20 transition"
              >
                Anladım
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

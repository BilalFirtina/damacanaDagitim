import React, { useState } from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Download, Smartphone, X } from 'lucide-react';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed PWA, hide the button
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-sky-700 active:scale-95 transition-all whitespace-nowrap"
        title="Uygulamayı Android veya Bilgisayarınıza Kurun"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Uygulamayı Yükle</span>
      </button>
    );
  }

  // iOS Safari flow
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-colors whitespace-nowrap"
        >
          <Smartphone className="w-3.5 h-3.5 text-sky-600" />
          <span>Ana Ekrana Ekle</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">iPhone / iPad Kurulumu</h3>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <p className="flex items-start gap-2">
                  <span className="font-bold text-sky-600">1.</span>
                  <span>Safari alt menüsündeki <strong>Paylaş</strong> (kare ve yukarı ok) simgesine dokunun.</span>
                </p>
                <p className="flex items-start gap-2">
                  <span className="font-bold text-sky-600">2.</span>
                  <span>Açılan menüyü aşağı kaydırıp <strong>"Ana Ekrana Ekle"</strong> seçeneğini seçin.</span>
                </p>
                <p className="flex items-start gap-2">
                  <span className="font-bold text-sky-600">3.</span>
                  <span>Sağ üstteki <strong>"Ekle"</strong> butonuna dokunarak tam ekran uygulama konforuna geçin.</span>
                </p>
              </div>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-6 w-full rounded-xl bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 transition"
              >
                Anladım
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

import React, { useState } from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { Download, Check, Share2, PlusSquare, Smartphone, X, ExternalLink } from 'lucide-react';

interface PWAInstallButtonProps {
  className?: string;
  variant?: 'primary' | 'header';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ className = '', variant = 'primary' }) => {
  const { isInstalled, isInstallable, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [showAndroidManualModal, setShowAndroidManualModal] = useState(false);

  // If already running in standalone/installed mode, show that it is installed
  if (isInstalled) {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3.5 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-300 shadow-xs ${className}`}
        title="Uygulama telefonunuzda kurulu modda çalışıyor"
      >
        <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        <span>Uygulama Yüklü</span>
      </div>
    );
  }

  const handleClick = async () => {
    // 1. If native install prompt is ready (Android Chrome / Edge / Desktop)
    if (isInstallable) {
      const result = await install();
      if (result === 'accepted') {
        return;
      }
      return;
    }

    // 2. If on iOS (iPhone / iPad), show Safari installation instructions
    if (isIOS) {
      setShowIOSModal(true);
      return;
    }

    // 3. If in an iframe (e.g. preview environment), open standalone window
    const isInIframe = window.self !== window.top;
    if (isInIframe) {
      window.open(window.location.href, '_blank');
      return;
    }

    // 4. Otherwise, attempt install prompt or show manual installation guide
    const result = await install();
    if (result === 'unsupported' || result === 'dismissed') {
      setShowAndroidManualModal(true);
    }
  };

  const isHeader = variant === 'header';

  return (
    <>
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

      {/* iOS Safari Kurulum Rehberi */}
      {showIOSModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-3 animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm">
                <Smartphone className="w-5 h-5 text-sky-600" />
                <span>iPhone / iPad Yükleme</span>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSModal(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400">
              Safari tarayıcısında uygulamayı tek dokunuşla ana ekranınıza ekleyebilirsiniz:
            </p>

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <div className="w-7 h-7 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-600 flex items-center justify-center shrink-0">
                  <Share2 className="w-4 h-4" />
                </div>
                <div>
                  <span className="font-bold text-slate-800 dark:text-slate-200">1. Adım:</span> Safari alt çubuğundaki <strong className="text-sky-600">Paylaş</strong> simgesine dokunun.
                </div>
              </div>

              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <div className="w-7 h-7 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-600 flex items-center justify-center shrink-0">
                  <PlusSquare className="w-4 h-4" />
                </div>
                <div>
                  <span className="font-bold text-slate-800 dark:text-slate-200">2. Adım:</span> Açılan sayfada aşağı kaydırıp <strong className="text-sky-600">&quot;Ana Ekrana Ekle&quot;</strong> seçeneğine dokunun.
                </div>
              </div>

              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center shrink-0 font-bold text-xs">
                  3
                </div>
                <div>
                  <span className="font-bold text-slate-800 dark:text-slate-200">3. Adım:</span> Sağ üst köşedeki <strong className="text-emerald-600">&quot;Ekle&quot;</strong> butonuna basın.
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowIOSModal(false)}
              className="w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs shadow-md transition-colors cursor-pointer"
            >
              Anladım
            </button>
          </div>
        </div>
      )}

      {/* Android / Tarayıcı Menüsünden Kurulum Rehberi */}
      {showAndroidManualModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-3 animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm">
                <Smartphone className="w-5 h-5 text-sky-600" />
                <span>Telefona Yükleme Rehberi</span>
              </div>
              <button
                type="button"
                onClick={() => setShowAndroidManualModal(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400">
              Tarayıcınız üzerinden uygulamayı tek tıkla cihazınıza yükleyebilirsiniz:
            </p>

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <div className="w-7 h-7 rounded-lg bg-sky-100 dark:bg-sky-950 text-sky-600 flex items-center justify-center font-bold text-sm shrink-0">
                  ⋮
                </div>
                <div>
                  <span className="font-bold text-slate-800 dark:text-slate-200">1. Adım:</span> Tarayıcınızın sağ üstündeki <strong className="text-sky-600">üç nokta (⋮)</strong> menüsüne dokunun.
                </div>
              </div>

              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center shrink-0">
                  <Download className="w-4 h-4" />
                </div>
                <div>
                  <span className="font-bold text-slate-800 dark:text-slate-200">2. Adım:</span> Menüdeki <strong className="text-emerald-600">&quot;Uygulamayı Yükle&quot;</strong> veya <strong className="text-emerald-600">&quot;Ana Ekrana Ekle&quot;</strong> seçeneğine dokunun.
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowAndroidManualModal(false)}
              className="w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs shadow-md transition-colors cursor-pointer"
            >
              Tamam
            </button>
          </div>
        </div>
      )}
    </>
  );
};

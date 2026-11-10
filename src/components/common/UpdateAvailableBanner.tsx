import React from 'react';
import { RefreshCw, DownloadCloud } from 'lucide-react';

// AGENTS.md Bölüm 12.2 — Uygulama güncellemesi sayfanın yenilenmesini
// gerektirdiğinde kullanıcı Türkçe bilgilendirilir. Bant, yeni servis çalışanı
// devreye girdiğinde (controllerchange) gösterilir; ilk kurulumda gösterilmez.
export const UpdateAvailableBanner: React.FC = () => {
  return (
    <div
      role="status"
      className="w-full max-w-full min-w-0 rounded-2xl border-2 border-sky-300  bg-sky-50  p-3 sm:p-4 shadow-xs flex flex-col sm:flex-row sm:items-center gap-3 print:hidden"
    >
      <div className="flex items-start gap-2.5 min-w-0 flex-1">
        <div className="w-9 h-9 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-sm">
          <DownloadCloud className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs sm:text-sm font-bold text-sky-950  break-words">
            Uygulama güncellendi
          </p>
          <p className="text-[11px] sm:text-xs text-sky-900/80  break-words mt-0.5">
            Yeni sürümü kullanmak için sayfayı yenileyin. Kaydedilmemiş bir işleminiz varsa önce
            tamamlayın.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => window.location.reload()}
        className="w-full sm:w-auto shrink-0 px-4 py-3 sm:py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all"
      >
        <RefreshCw className="w-4 h-4" />
        <span>Yenile</span>
      </button>
    </div>
  );
};

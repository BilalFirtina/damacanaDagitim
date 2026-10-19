import React, { useState, useEffect } from 'react';
import { CleanupStatus } from '../../types';
import {
  Trash2,
  ShieldCheck,
  CheckCircle2,
  Clock,
  RefreshCw,
  Database,
  Copy,
  Check
} from 'lucide-react';
import { fetchCleanupStatus, triggerManualCleanup } from '../../services/api';

export const DataRetentionView: React.FC = () => {
  const [status, setStatus] = useState<CleanupStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<any>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const data = await fetchCleanupStatus();
      setStatus(data);
    } catch (err: any) {
      console.error('Failed to load cleanup status', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();

    // Auto refresh status every 30 seconds to keep next run countdown fresh
    const interval = setInterval(loadStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleTrigger = async () => {
    if (!window.confirm('60 günden eski tüm tamamlanmış sefer ve teslimat kayıtları silinecektir. Devam etmek istiyor musunuz?')) {
      return;
    }

    try {
      setPurging(true);
      const res = await triggerManualCleanup();
      setPurgeResult(res);
      await loadStatus();
    } catch (err: any) {
      alert(err.message || 'Temizlik çalıştırılamadı');
    } finally {
      setPurging(false);
    }
  };

  const supabaseSqlCode = `-- 60 Günlük Saklama Temizliği (atomik + arşiv-önce + kilitli)
-- Gerçek silme için p_dry_run = false; test için true bırakın.
-- Silinen satırlar public.retention_archive tablosuna JSONB olarak yazılır.
SELECT public.purge_retention(
  true,                 -- p_dry_run
  ARRAY[]::text[],      -- p_dispatch_ids (boş: fonksiyon eşikten eskileri seçer)
  ARRAY[]::text[],      -- p_delivery_ids (boş: sefere bağlı teslimatlar)
  60                    -- p_retention_days
);`;

  const handleCopySql = () => {
    navigator.clipboard.writeText(supabaseSqlCode);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  };

  return (
    <div className="space-y-6 w-full max-w-full min-w-0">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4 w-full max-w-full">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-600" />
              <span>60 Günlük Otomatik Veri Temizliği (Her Gece 23:00)</span>
            </h2>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
              Aktif Zamanlayıcı: 23:00
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Dağıtım üzerinden 60 gün (2 ay) geçtikten sonra eski sefer ve teslimat fişleri önce kalıcı arşive (retention_archive) yazılır, ardından atomik olarak silinir. Varsayılan mod DRY-RUN'dır; gerçek silme yalnızca RETENTION_DRY_RUN=false iken yapılır.
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto">
          <button
            onClick={loadStatus}
            disabled={loading}
            className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-600 dark:text-slate-300 transition-colors"
            title="Durumu Yenile"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-600' : ''}`} />
          </button>

          <button
            onClick={handleTrigger}
            disabled={purging}
            className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all whitespace-nowrap flex-1 md:flex-initial"
          >
            <Trash2 className="w-4 h-4" />
            <span>{purging ? 'Temizleniyor...' : 'Şimdi Manuel Temizle'}</span>
          </button>
        </div>
      </div>

      {/* Dry-run / health status strip */}
      <div className="flex flex-col sm:flex-row gap-3 w-full max-w-full">
        <div
          className={`flex-1 rounded-xl border p-3 text-xs flex items-start gap-2 ${
            status?.health?.lastDryRun === false
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
          }`}
        >
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="font-bold">
              {status?.health?.lastDryRun === false
                ? 'Gerçek silme modu aktif (RETENTION_DRY_RUN=false)'
                : 'DRY-RUN modu aktif — hiçbir kayıt silinmez'}
            </div>
            <div className="text-[11px] opacity-80">
              Son başarılı çalışma: {status?.health?.lastSuccessAt ? new Date(status.health.lastSuccessAt).toLocaleString('tr-TR') : 'Kayıt yok'}
            </div>
          </div>
        </div>

        {status?.health?.stale && (
          <div className="flex-1 rounded-xl border p-3 text-xs flex items-start gap-2 bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300">
            <Clock className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-bold">Uyarı: 3 günden uzun süredir başarılı temizlik yok</div>
              <div className="text-[11px] opacity-80 break-words">
                Son hata: {status?.health?.lastError || 'yok'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Saklama Kuralı
          </span>
          <div className="text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
            60 Gün (2 Ay)
          </div>
          <span className="text-[11px] text-slate-400">Sabit Otomatik Politika</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Silme Eşik Tarihi
          </span>
          <div className="text-lg font-black font-mono text-amber-600 mt-1">
            {status?.thresholdDate || 'Hesaplanıyor...'}
          </div>
          <span className="text-[11px] text-slate-400">Bu tarihten eskiler silinir</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/20 shadow-xs">
          <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider block">
            Sonraki Otomatik Çalışma
          </span>
          <div className="text-xs font-bold font-mono text-indigo-900 dark:text-indigo-200 mt-1 leading-snug">
            {status?.nextScheduledRun || 'Her Gece 23:00'}
          </div>
          <span className="text-[10px] text-indigo-600/70 dark:text-indigo-400/80">Sunucu Zamanlayıcısı</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Aktif Sefer & Teslimat
          </span>
          <div className="text-lg font-black font-mono text-sky-600 mt-1">
            {status?.totalDispatches || 0} Sefer · {status?.totalDeliveries || 0} Fiş
          </div>
          <span className="text-[11px] text-slate-400">Son 60 günün operasyonu</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Toplam Temizlenen
          </span>
          <div className="text-lg font-black font-mono text-emerald-600 mt-1">
            {status?.purgedCountTotal || 0} Kayıt
          </div>
          <span className="text-[11px] text-slate-400">Sistem açılışından beri</span>
        </div>
      </div>

      {/* Purge Result Alert Banner */}
      {purgeResult && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="font-bold flex items-center gap-1.5 text-emerald-900 dark:text-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>
                {purgeResult.dryRun
                  ? 'DRY-RUN tamamlandı (hiçbir kayıt silinmedi)'
                  : '60 Günlük Temizlik Başarıyla Gerçekleştirildi'}
              </span>
            </div>
            <p className="text-[11px]">
              Sefer: <strong>{purgeResult.purgedDispatches}</strong> · Teslimat Fişi: <strong>{purgeResult.purgedDeliveries}</strong> · Arşivlenen Satır: <strong>{purgeResult.archivedRows ?? 0}</strong> · Eşik: <strong>{purgeResult.thresholdDate}</strong>
            </p>
          </div>
          <span className="text-[10px] text-emerald-600 font-mono">
            {new Date().toLocaleTimeString('tr-TR')}
          </span>
        </div>
      )}

      {/* Safe Data Guarantee Card */}
      <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 rounded-2xl border border-emerald-200 dark:border-emerald-800 p-5 shadow-xs space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-sm font-bold text-emerald-950 dark:text-emerald-200">
            Müşteri Bakiyeleri ve Cari Borç Güvenlik Garantisi
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-emerald-900 dark:text-emerald-300">
          <div className="p-3 rounded-xl bg-white/70 dark:bg-slate-900/60 border border-emerald-200/60 dark:border-emerald-800/60">
            <div className="font-bold mb-1 text-slate-900 dark:text-white flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Müşteri Cari Borçları</span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
              Müşterilerin kalan borç bakiyeleri (TL) kesinlikle silinmez, eksiksiz korunur.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-white/70 dark:bg-slate-900/60 border border-emerald-200/60 dark:border-emerald-800/60">
            <div className="font-bold mb-1 text-slate-900 dark:text-white flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Depozitolu Damacana Sayıları</span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
              Müşterilerde bulunan depozito damacana ve tüp sayıları kalıcı olarak saklanır.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-white/70 dark:bg-slate-900/60 border border-emerald-200/60 dark:border-emerald-800/60">
            <div className="font-bold mb-1 text-slate-900 dark:text-white flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Müşteri & Ürün Listeleri</span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
              Müşteri kartları, adresleri, özel fiyatları ve ürün kataloğu asla silinmez.
            </p>
          </div>
        </div>
      </div>

      {/* Supabase Direct SQL Cron Reference Box */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-sky-600" />
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Supabase SQL Editor Doğrudan Temizleme Kodu
            </h3>
          </div>
          <button
            onClick={handleCopySql}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-200 font-semibold text-xs flex items-center gap-1 transition-colors"
          >
            {copiedSql ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-600">Kopyalandı</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>SQL Kopyala</span>
              </>
            )}
          </button>
        </div>

        <p className="text-xs text-slate-500">
          Uygulama sunucusu her açılışta ve her gece 23:00'da bu temizliği çalıştırır (varsayılan DRY-RUN). Silme yetkisi yalnızca service_role'a aittir; fonksiyon advisory lock ile eşzamanlı çalışmayı engeller.
        </p>

        <pre className="p-3.5 rounded-xl bg-slate-900 text-sky-300 font-mono text-xs overflow-x-auto border border-slate-800">
          {supabaseSqlCode}
        </pre>
      </div>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { CleanupStatus } from '../../types';
import { Trash2, ShieldAlert, CheckCircle2, Clock, Calendar, RefreshCw, Database } from 'lucide-react';
import { fetchCleanupStatus, triggerManualCleanup } from '../../services/api';

export const DataRetentionView: React.FC = () => {
  const [status, setStatus] = useState<CleanupStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<any>(null);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const data = await fetchCleanupStatus();
      setStatus(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleTrigger = async () => {
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-600" />
              <span>2 Ay (60 Gün) Sonra Otomatik Kayıt Temizliği</span>
            </h2>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
              Aktif Politika
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Dağıtım üzerinden 60 gün (2 ay) geçtikten sonra sistem veritabanını hafif tutmak için eski sefer ve teslimat kayıtları otomatik olarak temizlenir.
          </p>
        </div>

        <button
          onClick={handleTrigger}
          disabled={purging}
          className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-all whitespace-nowrap"
        >
          <Trash2 className="w-4 h-4" />
          <span>{purging ? 'Temizleniyor...' : 'Temizliği Şimdi Kontrol Et & Çalıştır'}</span>
        </button>
      </div>

      {/* Policy Details Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Saklama Süresi
          </span>
          <div className="text-2xl font-extrabold font-mono text-slate-900 dark:text-white mt-1">
            60 Gün (2 Ay)
          </div>
          <span className="text-[11px] text-slate-400">Sabit Otomatik Kural</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Silme Eşik Tarihi
          </span>
          <div className="text-xl font-extrabold font-mono text-amber-600 mt-1">
            {status?.thresholdDate || 'Hesaplanıyor...'}
          </div>
          <span className="text-[11px] text-slate-400">Bu tarihten eskiler temizlenir</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Veritabanındaki En Eski Kayıt
          </span>
          <div className="text-xl font-extrabold font-mono text-slate-800 dark:text-slate-200 mt-1">
            {status?.oldestRecordDate || 'Kayıt Yok'}
          </div>
          <span className="text-[11px] text-slate-400">Güvenli saklama sınırında</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Mevcut Aktif Kayıtlar
          </span>
          <div className="text-xl font-extrabold font-mono text-sky-600 mt-1">
            {status?.totalDispatches || 0} Sefer / {status?.totalDeliveries || 0} Teslimat
          </div>
          <span className="text-[11px] text-slate-400">Kalıcı JSON depolama</span>
        </div>
      </div>

      {purgeResult && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
          <div className="font-bold flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Temizlik Başarıyla Gerçekleştirildi</span>
          </div>
          <p className="mt-1">
            Silinen Sefer Sayısı: <strong>{purgeResult.purgedDispatches}</strong> · Silinen Teslimat Sayısı: <strong>{purgeResult.purgedDeliveries}</strong>
          </p>
        </div>
      )}

      {/* Explanation Article */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3 text-xs text-slate-600 dark:text-slate-300">
        <h3 className="font-bold text-sm text-slate-900 dark:text-white">
          Nasıl Çalışır?
        </h3>
        <ul className="list-disc list-inside space-y-1.5">
          <li>
            Sunucu her başlatıldığında ve arka planda periyodik olarak, tarihi bugünün tarihinden 60 gün öncesinde kalan tüm araç seferlerini (dispatches) ve teslimat dökümlerini (deliveries) tarar.
          </li>
          <li>
            60 günü dolduran geçmiş seferler sistem diskinden ve bellekten güvenle silinir.
          </li>
          <li>
            Müşteri rehberi ve güncel müşteri borç/alacak bakiyeleri korunur, yalnızca operasyonel günlük teslimat hareketleri temizlenir.
          </li>
        </ul>
      </div>
    </div>
  );
};

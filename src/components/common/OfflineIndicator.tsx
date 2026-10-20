import React, { useEffect, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { getOfflineQueue, syncOfflineDeliveries } from '../../services/api';

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const checkQueue = () => {
    const queue = getOfflineQueue();
    setPendingCount(queue.length);
    setConflictCount(queue.filter((item) => item?.syncStatus === 'conflict').length);
  };

  useEffect(() => {
    checkQueue();

    const handleOnline = async () => {
      setIsOnline(true);
      // Otomatik senkron: çakışmalar atlanır, kuyrukta korunur.
      setIsSyncing(true);
      await syncOfflineDeliveries(false);
      setIsSyncing(false);
      checkQueue();
    };

    const handleOffline = () => {
      setIsOnline(false);
      checkQueue();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const interval = setInterval(checkQueue, 5000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  const handleManualSync = async () => {
    if (!isOnline) return;
    setIsSyncing(true);
    // Kullanıcı açıkça istediğinde çakışan kayıtlar da yeniden denenir
    // (ör. yönetici seferi yeniden açtıktan sonra).
    await syncOfflineDeliveries(true);
    setIsSyncing(false);
    checkQueue();
  };

  const hasUnsynced = pendingCount > 0 || conflictCount > 0;
  if (isOnline && !hasUnsynced) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 z-30 min-w-11 min-h-11 px-2.5 rounded-xl bg-slate-900/95 text-white shadow-2xl border border-slate-700 backdrop-blur-md flex items-center justify-center gap-1.5"
        aria-label={
          hasUnsynced
            ? `Senkronizasyon bekleyen ${pendingCount} kayıt. Detayları aç.`
            : 'Çevrimdışı mod. Detayları aç.'
        }
        title={hasUnsynced ? `${pendingCount} kayıt senkronizasyon bekliyor` : 'Çevrimdışı Mod'}
      >
        {!isOnline ? (
          <WifiOff className="w-5 h-5 text-amber-400" />
        ) : (
          <RefreshCw className="w-5 h-5 text-sky-400" />
        )}
        {hasUnsynced && (
          <span
            className={`min-w-5 h-5 px-1 rounded-full text-xs font-bold flex items-center justify-center ${
              conflictCount > 0 ? 'bg-amber-400 text-slate-950' : 'bg-sky-500 text-white'
            }`}
          >
            {pendingCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      onClick={() => setCollapsed(true)}
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 z-30 max-w-[calc(100vw-2rem)] flex flex-wrap items-center gap-2 rounded-xl bg-slate-900/95 text-white px-3.5 py-2 shadow-2xl border border-slate-700 backdrop-blur-md text-sm cursor-pointer"
      title="Daraltmak için dokunun"
    >
      {!isOnline ? (
        <>
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
          </span>
          <WifiOff className="w-4 h-4 text-amber-400" />
          <span className="font-medium text-amber-200">Çevrimdışı Mod</span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-300">İnternet kesildi, kayıtlar hafızada tutuluyor ({pendingCount})</span>
        </>
      ) : (
        <>
          <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${isSyncing ? 'animate-spin' : ''}`} />
          {conflictCount > 0 ? (
            <span className="text-amber-200" title="Sefer kapatıldığı için uygulanamadı. Yönetici seferi yeniden açtıktan sonra 'Şimdi Eşitle' ile tekrar deneyin.">
              Çözüm bekleyen <strong className="text-amber-300">{conflictCount}</strong> kayıt
              {pendingCount > conflictCount
                ? ` · ${pendingCount - conflictCount} bekliyor`
                : ' · yönetici onayı gerekli'}
            </span>
          ) : (
            <span className="text-slate-200">Senkronizasyon Bekleyen: <strong className="text-sky-300">{pendingCount}</strong> kayıt</span>
          )}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleManualSync();
            }}
            disabled={isSyncing}
            className="ml-1.5 min-h-11 px-3 py-2 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium text-sm transition-colors"
          >
            {isSyncing ? 'Gönderiliyor...' : 'Şimdi Eşitle'}
          </button>
        </>
      )}
    </div>
  );
};

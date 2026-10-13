import React, { useEffect, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { getOfflineQueue, syncOfflineDeliveries } from '../../services/api';

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const checkQueue = () => {
    const queue = getOfflineQueue();
    setPendingCount(queue.length);
  };

  useEffect(() => {
    checkQueue();

    const handleOnline = async () => {
      setIsOnline(true);
      // Auto trigger sync
      setIsSyncing(true);
      await syncOfflineDeliveries();
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
    await syncOfflineDeliveries();
    setIsSyncing(false);
    checkQueue();
  };

  if (isOnline && pendingCount === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-slate-900/95 text-white px-3.5 py-2 shadow-2xl border border-slate-700 backdrop-blur-md text-xs">
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
          <span className="text-slate-200">Senkronizasyon Bekleyen: <strong className="text-sky-300">{pendingCount}</strong> kayıt</span>
          <button
            onClick={handleManualSync}
            disabled={isSyncing}
            className="ml-1.5 px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium text-[11px] transition-colors"
          >
            {isSyncing ? 'Gönderiliyor...' : 'Şimdi Eşitle'}
          </button>
        </>
      )}
    </div>
  );
};

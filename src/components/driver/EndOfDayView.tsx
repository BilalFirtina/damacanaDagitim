import React, { useState } from 'react';
import { Dispatch, Delivery, Product, User } from '../../types';
import { todayUtcDateStr } from '../../services/dateWindow';
import {
  CheckCircle2,
  AlertCircle,
  Wallet,
  RotateCcw,
  Droplet,
  Printer,
  FileCheck,
  Building2,
  ArrowRight,
  Truck,
  Plus
} from 'lucide-react';
import { closeDispatch, reopenDispatch } from '../../services/api';

interface EndOfDayViewProps {
  dispatch: Dispatch | null;
  dispatches?: Dispatch[];
  deliveries: Delivery[];
  products: Product[];
  currentUser: User;
  onDispatchUpdated: (updated: Dispatch) => void;
  onNavigateTab?: (tab: any) => void;
  onRefreshData?: () => Promise<void> | void;
}

export const EndOfDayView: React.FC<EndOfDayViewProps> = ({
  dispatch: activeDispatchProp,
  dispatches = [],
  deliveries,
  products,
  currentUser,
  onDispatchUpdated,
  onNavigateTab,
  onRefreshData,
}) => {
  const todayStr = todayUtcDateStr();

  // Dispatches belonging to this driver/user or all for admin
  const candidateDispatches = dispatches.filter((d) => {
    if (d.date !== todayStr) return false;
    if (currentUser.role === 'admin') return true;
    return d.driverId === currentUser.id;
  });

  // Selected dispatch ID state
  const [selectedDispatchId, setSelectedDispatchId] = useState<string>(() => {
    if (activeDispatchProp) return activeDispatchProp.id;
    // Prefer open dispatch if any
    const openDispatch = candidateDispatches.find((d) => d.status !== 'completed');
    if (openDispatch) return openDispatch.id;
    // Else most recent completed dispatch
    return candidateDispatches[0]?.id || '';
  });

  // Resolve currently viewed dispatch
  const currentViewDispatch =
    candidateDispatches.find((d) => d.id === selectedDispatchId) ||
    activeDispatchProp ||
    candidateDispatches[0] ||
    null;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState(false);
  const [closureNotes, setClosureNotes] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [isReopening, setIsReopening] = useState(false);

  if (!currentViewDispatch) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center text-slate-400 text-xs space-y-3">
        <Truck className="w-10 h-10 text-slate-300 mx-auto" />
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          Bugün için tamamlanmış veya aktif bir araç seferi bulunmuyor.
        </p>
        <p className="text-xs text-slate-400">
          Dağıtıma başlamak için önce araç yüklemesi yapılmalı ve sefer başlatılmalıdır.
        </p>
        {onNavigateTab && (
          <button
            onClick={() => onNavigateTab('delivery')}
            className="mt-3 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs inline-flex items-center gap-1.5"
          >
            <span>Dağıtım & Yükleme Ekranına Git</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  // Filter deliveries belonging to this dispatch
  const dispatchDeliveries = deliveries.filter(
    (d) => d.dispatchId === currentViewDispatch.id
  );

  // Delivered quantities by product
  const deliveredTotals: Record<string, number> = {};
  let totalDeliveredValue = 0;
  let totalCashCollected = 0;
  let totalPosCollected = 0;
  let totalCreditAdded = 0;
  let totalEmptyDamacanaCollected = 0;
  let totalEmptyCamDamacanaCollected = 0;
  let totalEmptyTupCollected = 0;

  dispatchDeliveries.forEach((del) => {
    totalDeliveredValue += del.deliveredGrandTotal;
    totalCashCollected += del.collectedPayment.cashAmount;
    totalPosCollected += del.collectedPayment.posAmount;
    if (del.collectedPayment.diffUncollected > 0) {
      totalCreditAdded += del.collectedPayment.diffUncollected;
    }
    totalEmptyDamacanaCollected += del.emptyContainersReceived.damacana || 0;
    totalEmptyCamDamacanaCollected += Number(del.emptyContainersReceived.camDamacana || del.emptyContainersReceived.cam_damacana) || 0;
    totalEmptyTupCollected += del.emptyContainersReceived.tup || 0;

    del.deliveredItems.forEach((item) => {
      deliveredTotals[item.productId] =
        (deliveredTotals[item.productId] || 0) + item.quantity;
    });
  });

  // Calculate expected remaining full items
  const expectedRemainingFull: Record<string, number> = {};
  currentViewDispatch.loadedItems.forEach((loaded) => {
    const deliveredCount = deliveredTotals[loaded.productId] || 0;
    expectedRemainingFull[loaded.productId] = Math.max(
      0,
      loaded.quantity - deliveredCount
    );
  });

  // Counted full items state
  const isAlreadyClosed = currentViewDispatch.status === 'completed';

  const countedFull =
    currentViewDispatch.endOfDayReconciliation?.remainingFullCounted ||
    expectedRemainingFull;

  const actualCashInPocket =
    currentViewDispatch.endOfDayReconciliation?.actualCashInPocket ??
    totalCashCollected;

  const actualPosSlipsTotal =
    currentViewDispatch.endOfDayReconciliation?.actualPosSlipsTotal ??
    totalPosCollected;

  const handleCloseShift = async () => {
    try {
      setIsSubmitting(true);
      const updated = await closeDispatch(currentViewDispatch.id, {
        closedByUserId: currentUser.id,
        closedByUserName: currentUser.name,
        remainingFullCounted: countedFull,
        collectedEmptyDamacana: totalEmptyDamacanaCollected,
        collectedEmptyCamDamacana: totalEmptyCamDamacanaCollected,
        collectedEmptyTup: totalEmptyTupCollected,
        actualCashInPocket: Number(actualCashInPocket) || 0,
        actualPosSlipsTotal: Number(actualPosSlipsTotal) || 0,
        notes: closureNotes || currentViewDispatch.endOfDayReconciliation?.notes || '',
      });

      onDispatchUpdated(updated);
      if (onRefreshData) {
        try {
          await onRefreshData();
        } catch (e) {
          console.error('Refresh after shift close failed', e);
        }
      }
      setSuccessMsg(true);
    } catch (err: any) {
      alert(err.message || 'Kapatma işlemi başarısız');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReopen = async () => {
    if (reopenReason.trim().length < 3) {
      alert('Yeniden açma için en az 3 karakterlik bir gerekçe girin.');
      return;
    }
    try {
      setIsReopening(true);
      const result = await reopenDispatch(currentViewDispatch.id, reopenReason.trim());
      if (result.dispatch) onDispatchUpdated(result.dispatch);
      if (onRefreshData) {
        try {
          await onRefreshData();
        } catch (e) {
          console.error('Refresh after reopen failed', e);
        }
      }
      setReopenReason('');
      setSuccessMsg(false);
      alert('Sefer yeniden açıldı. Bu işlem denetim kaydına alındı.');
    } catch (err: any) {
      alert(err.message || 'Sefer yeniden açılamadı');
    } finally {
      setIsReopening(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 w-full max-w-full min-w-0">
      {/* Trip Switcher if Multiple Dispatches exist today */}
      {candidateDispatches.length > 1 && (
        <div className="bg-slate-100 dark:bg-slate-800/80 p-2.5 rounded-2xl flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
            <Truck className="w-4 h-4 text-sky-600" />
            <span>Bugünkü Seferler ({candidateDispatches.length}):</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {candidateDispatches.map((disp, idx) => (
              <button
                key={disp.id}
                onClick={() => {
                  setSelectedDispatchId(disp.id);
                  setSuccessMsg(false);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  disp.id === currentViewDispatch.id
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50'
                }`}
              >
                <span>
                  Sefer #{idx + 1} ({disp.vehiclePlate})
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                    disp.status === 'completed'
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                  }`}
                >
                  {disp.status === 'completed' ? 'Kapatıldı' : 'Açık'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Completion & Readiness Success Banner */}
      {(isAlreadyClosed || successMsg) && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border-2 border-emerald-300 dark:border-emerald-800 rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-md">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-emerald-950 dark:text-emerald-200">
                  Sefer Başarıyla Tamamlandı & Kalan Ürünler Depoya Boşaltıldı
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200">
                  Yeni Sefere Hazır
                </span>
              </div>
              <p className="text-xs text-emerald-800/90 dark:text-emerald-300 mt-1">
                Bu seferin mutabakatı tamamlandı ve araç depoya boşaltıldı. Şoför ve araç sisteme serbest bırakıldı, yeni bir sefer yüklemesi yapılabilir.
              </p>
            </div>
          </div>

          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab('delivery')}
              className="px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs flex items-center gap-2 shadow-md shrink-0 active:scale-95 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Yeni Sefer Yükleme Ekranına Git</span>
            </button>
          )}
        </div>
      )}

      {/* Title & Status Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Gün Sonu Çift Yönlü Mutabakat & Kasa Kapatma
            </h2>
            {isAlreadyClosed ? (
              <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                Sefer Kapatıldı & Mutabakat Sağlandı
              </span>
            ) : (
              <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                Açık Dağıtım Seferi
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Araç: <strong>{currentViewDispatch.vehiclePlate}</strong> · Şoför: <strong>{currentViewDispatch.driverName}</strong> · Toplam Teslimat: <strong>{dispatchDeliveries.length} Adet</strong>
            {isAlreadyClosed && currentViewDispatch.endOfDayReconciliation?.closedByUserName
              ? ` · Kapatan: ${currentViewDispatch.endOfDayReconciliation.closedByUserName}`
              : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-xs flex items-center gap-1.5 hover:bg-slate-50 shadow-xs"
          >
            <Printer className="w-4 h-4 text-slate-500" />
            <span>Yazdır / PDF</span>
          </button>
        </div>
      </div>

      {currentUser.role === 'admin' && isAlreadyClosed && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                Yönetici İşlemi: Seferi Yeniden Aç
              </h3>
              <p className="text-xs text-amber-800/80 dark:text-amber-300 mt-1">
                Kapatılmış sefer yeniden açıldığında şoför ve araç tekrar aktif seferde görünür.
                İşlem gerekçesiyle birlikte denetim kaydına alınır ve geçmiş toplamlar silinmez.
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="Yeniden açma gerekçesi (zorunlu)"
              maxLength={500}
              className="flex-1 min-w-0 p-2.5 rounded-xl border border-amber-300 dark:border-amber-700 text-xs bg-white dark:bg-slate-900 dark:text-white"
            />
            <button
              onClick={handleReopen}
              disabled={isReopening || reopenReason.trim().length < 3}
              className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-1.5 shrink-0"
            >
              <RotateCcw className={`w-4 h-4 ${isReopening ? 'animate-spin' : ''}`} />
              <span>{isReopening ? 'Açılıyor...' : 'Seferi Yeniden Aç'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Grid 1: Dolu ve Boş Ürün Sayım Tablosu */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Droplet className="w-4 h-4 text-sky-600" />
              <span>A. Depoya İndirilecek Kalan Dolu Ürünler</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Yüklenen - Teslim Edilen = Depoya İndirilmesi Gereken Sayı
            </p>
          </div>
        </div>

        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[460px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-semibold">
                <th className="pb-2.5">Ürün Adı</th>
                <th className="pb-2.5 text-center">Yüklenen</th>
                <th className="pb-2.5 text-center">Teslim Edilen</th>
                <th className="pb-2.5 text-center text-sky-600">Depoya İndirilen</th>
                <th className="pb-2.5 text-right">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {currentViewDispatch.loadedItems.map((loaded) => {
                const p = products.find((prod) => prod.id === loaded.productId);
                const delivered = deliveredTotals[loaded.productId] || 0;
                const expected = expectedRemainingFull[loaded.productId] || 0;
                const counted = countedFull[loaded.productId] ?? expected;

                return (
                  <tr key={loaded.productId} className="py-2.5">
                    <td className="py-3 font-medium text-slate-900 dark:text-white">
                      {p?.name || loaded.productId}
                    </td>
                    <td className="py-3 text-center font-mono font-bold">{loaded.quantity}</td>
                    <td className="py-3 text-center font-mono text-emerald-600 font-bold">{delivered}</td>
                    <td className="py-3 text-center font-mono font-bold text-sky-600">
                      {counted} {p?.unit || 'Adet'}
                    </td>
                    <td className="py-3 text-right">
                      <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded-md">
                        Mutabık
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Grid 2: Boş Kap & Tahsilat Mutabakatı */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Wallet className="w-4 h-4 text-emerald-600" />
          <span>B. Boş Kap & Kasa Tahsilat Mutabakatı</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <span className="text-[11px] font-semibold text-slate-500 uppercase">Toplanan Boş Damacana</span>
            <div className="text-xl font-bold font-mono text-slate-900 dark:text-white mt-1">
              {totalEmptyDamacanaCollected} Adet
            </div>
            <span className="text-[10px] text-slate-400">Depoya teslim edilecek boşlar</span>
          </div>

          <div className="p-3.5 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
            <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 uppercase">Toplanan Boş Cam Damacana</span>
            <div className="text-xl font-bold font-mono text-amber-700 dark:text-amber-400 mt-1">
              {totalEmptyCamDamacanaCollected} Adet
            </div>
            <span className="text-[10px] text-amber-600/80">Depoya teslim edilecek boş camlar</span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <span className="text-[11px] font-semibold text-slate-500 uppercase">Toplanan Boş Tüp</span>
            <div className="text-xl font-bold font-mono text-slate-900 dark:text-white mt-1">
              {totalEmptyTupCollected} Adet
            </div>
            <span className="text-[10px] text-slate-400">Depoya teslim edilecek tüpler</span>
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
            <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase">Nakit Kasa</span>
            <div className="text-xl font-bold font-mono text-emerald-600 mt-1">
              {actualCashInPocket.toLocaleString('tr-TR')} ₺
            </div>
            <span className="text-[10px] text-emerald-600/80">Teslim edilecek nakit para</span>
          </div>

          <div className="p-3.5 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800">
            <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-400 uppercase">POS Slipleri</span>
            <div className="text-xl font-bold font-mono text-indigo-600 mt-1">
              {actualPosSlipsTotal.toLocaleString('tr-TR')} ₺
            </div>
            <span className="text-[10px] text-indigo-600/80">Banka slip toplamı</span>
          </div>
        </div>

        {/* Closure Note Input */}
        {!isAlreadyClosed && (
          <div className="pt-2">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1">
              Depoya Teslim & Gün Sonu Kapatma Notu:
            </label>
            <input
              type="text"
              placeholder="Örn: Tüm ürünler depoya eksiksiz indirildi, kasa teslim edildi..."
              value={closureNotes}
              onChange={(e) => setClosureNotes(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 dark:text-white"
            />
          </div>
        )}

        {/* Final Closure Action Button */}
        {!isAlreadyClosed && (
          <div className="pt-3 flex items-center justify-end">
            <button
              onClick={handleCloseShift}
              disabled={isSubmitting}
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all"
            >
              <FileCheck className="w-4 h-4" />
              <span>
                {isSubmitting
                  ? 'Kapatılıyor & Depoya Boşaltılıyor...'
                  : 'Aracı Depoya Boşalt, Raporu Onayla & Seferi Kapat'}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Grid 3: Günlük Müşteri ve Teslimat Listesi Önizleme */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Building2 className="w-4 h-4 text-sky-600" />
          <span>Bu Seferdeki Müşteri Teslimatları ({dispatchDeliveries.length} Müşteri)</span>
        </h3>

        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          {dispatchDeliveries.length === 0 ? (
            <div className="p-4 text-center text-slate-400">Bu seferde henüz teslimat yapılmadı.</div>
          ) : (
            dispatchDeliveries.map((del, index) => (
              <div key={del.id} className="py-2.5 flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>{index + 1}. {del.customerName}</span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(del.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {del.deliveredItems.map((i) => `${i.quantity} ${i.productName}`).join(' · ')}
                    {del.emptyContainersReceived.damacana > 0 && ` · ${del.emptyContainersReceived.damacana} Boş`}
                    {(del.emptyContainersReceived.camDamacana || 0) > 0 && ` · ${del.emptyContainersReceived.camDamacana} Boş Cam`}
                    {del.emptyContainersReceived.tup > 0 && ` · ${del.emptyContainersReceived.tup} Boş Tüp`}
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono font-bold text-slate-900 dark:text-white">
                    {del.deliveredGrandTotal.toLocaleString('tr-TR')} ₺
                  </div>
                  <div className="text-[10px] text-emerald-600 font-semibold">
                    {del.collectedPayment.cashAmount > 0 && `${del.collectedPayment.cashAmount.toLocaleString('tr-TR')} ₺ Nakit `}
                    {del.collectedPayment.posAmount > 0 && `${del.collectedPayment.posAmount.toLocaleString('tr-TR')} ₺ POS `}
                    {del.collectedPayment.totalCollected === 0 && '0 ₺ Veresiye'}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

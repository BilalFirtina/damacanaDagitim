import React, { useEffect, useState } from 'react';
import { Customer, Dispatch, Delivery, Product, User } from '../../types';
import { isAccountCustomerDelivery } from '../../services/customerVisibility';
import { todayUtcDateStr, formatDateTr } from '../../services/dateWindow';
import { totalTupEmpty } from '../../services/depositRules';
import {
  findOldestStaleOpenDispatch,
  findStaleOpenDispatch,
  isStaleDispatch,
} from '../../services/dispatchRules';
import {
  CheckCircle2,
  AlertCircle,
  Wallet,
  Droplet,
  Printer,
  FileCheck,
  Building2,
  ArrowRight,
  Truck,
  Plus
} from 'lucide-react';
import {
  closeDispatch,
  fetchDispatchPayments,
  type DispatchPayment,
} from '../../services/api';

interface EndOfDayViewProps {
  dispatch: Dispatch | null;
  dispatches?: Dispatch[];
  /** Uyarıdan gelindiğinde açılacak sefer (tarihi geçmiş açık sefer olabilir). */
  selectedDispatchId?: string | null;
  deliveries: Delivery[];
  products: Product[];
  currentUser: User;
  customers?: Customer[];
  onDispatchUpdated: (updated: Dispatch) => void;
  onNavigateTab?: (tab: any) => void;
  onRefreshData?: () => void | Promise<unknown>;
}

export const EndOfDayView: React.FC<EndOfDayViewProps> = ({
  dispatch: activeDispatchProp,
  dispatches = [],
  selectedDispatchId: selectedDispatchIdProp,
  deliveries,
  products,
  currentUser,
  customers = [],
  onDispatchUpdated,
  onNavigateTab,
  onRefreshData,
}) => {
  const todayStr = todayUtcDateStr();

  // Sefer listesi: bugünün tüm seferleri + tarihi geçmiş ve hâlâ açık seferler.
  // AGENTS.md Bölüm 9.1 gereği dünün açık seferi de kapatılabilmelidir.
  const candidateDispatches = dispatches.filter((d) => {
    if (d.date !== todayStr && !isStaleDispatch(d, todayStr)) return false;
    if (currentUser.role === 'admin') return true;
    return d.driverId === currentUser.id;
  });

  // Selected dispatch ID state
  const [selectedDispatchId, setSelectedDispatchId] = useState<string>(() => {
    if (selectedDispatchIdProp) return selectedDispatchIdProp;
    // Önce sonlandırılmamış (tarihi geçmiş) sefer
    const staleDispatch =
      currentUser.role === 'admin'
        ? findOldestStaleOpenDispatch(candidateDispatches, todayStr)
        : findStaleOpenDispatch(candidateDispatches, currentUser.id, todayStr);
    if (staleDispatch) return staleDispatch.id;
    if (activeDispatchProp) return activeDispatchProp.id;
    // Prefer open dispatch if any
    const openDispatch = candidateDispatches.find((d) => d.status !== 'completed');
    if (openDispatch) return openDispatch.id;
    // Else most recent completed dispatch
    return candidateDispatches[0]?.id || '';
  });

  // Resolve currently viewed dispatch. Seçili sefer kapatıldığında listeden
  // düşse bile (tarihi geçmiş olabilir) görünüm korunur ve başarı bandı kalır.
  const currentViewDispatch =
    candidateDispatches.find((d) => d.id === selectedDispatchId) ||
    dispatches.find((d) => d.id === selectedDispatchId) ||
    activeDispatchProp ||
    candidateDispatches[0] ||
    null;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState(false);
  const [closureNotes, setClosureNotes] = useState('');
  const [dispatchPayments, setDispatchPayments] = useState<DispatchPayment[]>([]);

  // Ürün verilmeden alınan tahsilatlar kasa/POS mutabakatına girer.
  useEffect(() => {
    let cancelled = false;
    const dispatchId = currentViewDispatch?.id;
    if (!dispatchId) {
      setDispatchPayments([]);
      return;
    }
    fetchDispatchPayments(dispatchId)
      .then((payments) => {
        if (!cancelled) setDispatchPayments(payments);
      })
      .catch(() => {
        if (!cancelled) setDispatchPayments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentViewDispatch?.id]);

  // Uyarıdan "Gün Sonunu Tamamla" ile gelindiğinde doğru seferi aç.
  useEffect(() => {
    if (!selectedDispatchIdProp) return;
    if (candidateDispatches.some((d) => d.id === selectedDispatchIdProp)) {
      setSelectedDispatchId(selectedDispatchIdProp);
      setSuccessMsg(false);
    }
  }, [selectedDispatchIdProp]);

  if (!currentViewDispatch) {
    return (
      <div className="bg-white  rounded-2xl border border-slate-200  p-12 text-center text-slate-400 text-xs space-y-3">
        <Truck className="w-10 h-10 text-slate-300 mx-auto" />
        <p className="text-sm font-semibold text-slate-700 ">
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
  let totalEmptyTupBuyukCollected = 0;
  let totalEmptyTupKucukCollected = 0;
  let totalEmptyTupLegacyCollected = 0;
  let totalEmptySebilCollected = 0;

  dispatchDeliveries.forEach((del) => {
    totalDeliveredValue += del.deliveredGrandTotal;
    totalCashCollected += del.collectedPayment.cashAmount;
    totalPosCollected += del.collectedPayment.posAmount;
    if (del.collectedPayment.diffUncollected > 0) {
      totalCreditAdded += del.collectedPayment.diffUncollected;
    }
    totalEmptyDamacanaCollected += del.emptyContainersReceived.damacana || 0;
    totalEmptyCamDamacanaCollected += Number(del.emptyContainersReceived.camDamacana || del.emptyContainersReceived.cam_damacana) || 0;
    totalEmptyTupBuyukCollected +=
      Number(del.emptyContainersReceived?.tupBuyuk) || 0;
    totalEmptyTupKucukCollected +=
      Number(del.emptyContainersReceived?.tupKucuk) || 0;
    totalEmptyTupLegacyCollected += Number(del.emptyContainersReceived?.tup) || 0;
    totalEmptyTupCollected += totalTupEmpty(del.emptyContainersReceived);
    totalEmptySebilCollected += Number(del.emptyContainersReceived?.sebil) || 0;

    del.deliveredItems.forEach((item) => {
      deliveredTotals[item.productId] =
        (deliveredTotals[item.productId] || 0) + item.quantity;
    });
  });

  const standaloneCash = dispatchPayments
    .filter((p) => p.method === 'CASH')
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const standalonePos = dispatchPayments
    .filter((p) => p.method === 'POS')
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const standaloneTotal = standaloneCash + standalonePos;
  const cashPosPayments = dispatchPayments.filter(
    (p) => p.method === 'CASH' || p.method === 'POS'
  );

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
    totalCashCollected + standaloneCash;

  const actualPosSlipsTotal =
    currentViewDispatch.endOfDayReconciliation?.actualPosSlipsTotal ??
    totalPosCollected + standalonePos;

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
        collectedEmptySebil: totalEmptySebilCollected,
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

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 w-full max-w-full min-w-0">
      {/* Trip Switcher if Multiple Dispatches exist today */}
      {candidateDispatches.length > 1 && (
        <div className="bg-slate-100  p-2.5 rounded-2xl flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 ">
            <Truck className="w-4 h-4 text-sky-600" />
            <span>Seferler ({candidateDispatches.length}):</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {candidateDispatches.map((disp, idx) => (
              <button
                key={disp.id}
                onClick={() => {
                  setSelectedDispatchId(disp.id);
                  setSuccessMsg(false);
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex flex-wrap items-center gap-1.5 max-w-full ${
                  disp.id === currentViewDispatch.id
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'bg-white  text-slate-700  hover:bg-slate-50'
                }`}
              >
                <span>
                  Sefer #{idx + 1} ({disp.vehiclePlate})
                </span>
                {isStaleDispatch(disp, todayStr) && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded font-bold bg-rose-100 text-rose-800  ">
                    Önceki gün sonlandırılmadı
                  </span>
                )}
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                    disp.status === 'completed'
                      ? 'bg-emerald-100 text-emerald-800  '
                      : 'bg-amber-100 text-amber-800  '
                  }`}
                >
                  {disp.status === 'completed' ? 'Dağıtım Tamamlandı' : 'Açık'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* AGENTS.md Bölüm 9.1: tarihi geçmiş açık sefer uyarısı */}
      {isStaleDispatch(currentViewDispatch, todayStr) && (
        <div
          role="alert"
          className="bg-amber-50  border-2 border-amber-300  rounded-2xl p-4 sm:p-5 flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-900  break-words">
              Önceki gün sonlandırılmadı
            </p>
            <p className="text-xs text-amber-800/90  mt-1 break-words">
              Bu sefer {formatDateTr(currentViewDispatch.date)} tarihli ve hâlâ açık.
              Yeni sefere başlamadan önce sayımı tamamlayıp gün sonu raporunu onaylayarak seferi kapatın.
            </p>
          </div>
        </div>
      )}

      {/* Completion & Readiness Success Banner */}
      {(isAlreadyClosed || successMsg) && (
        <div className="bg-emerald-50  border-2 border-emerald-300  rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-md">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-emerald-950 ">
                  Sefer Başarıyla Tamamlandı & Kalan Ürünler Depoya Boşaltıldı
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-200  text-emerald-900 ">
                  Yeni Sefere Hazır
                </span>
              </div>
              <p className="text-xs text-emerald-800/90  mt-1">
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
      <div className="bg-white  rounded-2xl border border-slate-200  p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 ">
              Gün Sonu Çift Yönlü Mutabakat & Kasa Kapatma
            </h2>
            {isAlreadyClosed ? (
              <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800  ">
                Sefer Kapatıldı & Mutabakat Sağlandı
              </span>
            ) : (
              <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800  ">
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
            className="px-3.5 py-2 rounded-xl border border-slate-200  bg-white  text-slate-700  font-semibold text-xs flex items-center gap-1.5 hover:bg-slate-50 shadow-xs"
          >
            <Printer className="w-4 h-4 text-slate-500" />
            <span>Yazdır / PDF</span>
          </button>
        </div>
      </div>

      {/* Grid 1: Dolu ve Boş Ürün Sayım Tablosu */}
      <div className="bg-white  rounded-2xl border border-slate-200  p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 ">
          <div>
            <h3 className="text-sm font-bold text-slate-900  flex items-center gap-2">
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
              <tr className="border-b border-slate-100  text-slate-400 font-semibold">
                <th className="pb-2.5">Ürün Adı</th>
                <th className="pb-2.5 text-center">Yüklenen</th>
                <th className="pb-2.5 text-center">Teslim Edilen</th>
                <th className="pb-2.5 text-center text-sky-600">Depoya İndirilecekler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 ">
              {currentViewDispatch.loadedItems.map((loaded) => {
                const p = products.find((prod) => prod.id === loaded.productId);
                const delivered = deliveredTotals[loaded.productId] || 0;
                const expected = expectedRemainingFull[loaded.productId] || 0;
                const counted = countedFull[loaded.productId] ?? expected;

                return (
                  <tr key={loaded.productId} className="py-2.5">
                    <td className="py-3 font-medium text-slate-900 ">
                      {p?.name || loaded.productId}
                    </td>
                    <td className="py-3 text-center font-mono font-bold">{loaded.quantity}</td>
                    <td className="py-3 text-center font-mono text-emerald-600 font-bold">{delivered}</td>
                    <td className="py-3 text-center font-mono font-bold text-sky-600">
                      {counted} {p?.unit || 'Adet'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Grid 2: Boş Kap & Tahsilat Mutabakatı */}
      <div className="bg-white  rounded-2xl border border-slate-200  p-5 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-slate-900  flex items-center gap-2">
          <Wallet className="w-4 h-4 text-emerald-600" />
          <span>B. Boş Kap & Kasa Tahsilat Mutabakatı</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-50  border border-slate-200 ">
            <span className="text-[11px] font-semibold text-slate-500 uppercase">Toplanan Boş Damacana</span>
            <div className="text-xl font-bold font-mono text-slate-900  mt-1">
              {totalEmptyDamacanaCollected} Adet
            </div>
            <span className="text-[10px] text-slate-400">Depoya teslim edilecek boşlar</span>
          </div>

          <div className="p-3.5 rounded-xl bg-amber-50/50  border border-amber-200 ">
            <span className="text-[11px] font-semibold text-amber-700  uppercase">Toplanan Boş Cam Damacana</span>
            <div className="text-xl font-bold font-mono text-amber-700  mt-1">
              {totalEmptyCamDamacanaCollected} Adet
            </div>
            <span className="text-[10px] text-amber-600/80">Depoya teslim edilecek boş camlar</span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50  border border-slate-200 ">
            <span className="text-[11px] font-semibold text-slate-500 uppercase">
              Toplanan Boş Tüp (Büyük / Küçük)
            </span>
            <div className="text-xl font-bold font-mono text-slate-900  mt-1">
              {totalEmptyTupBuyukCollected} / {totalEmptyTupKucukCollected}
            </div>
            <span className="text-[10px] text-slate-400">
              Toplam {totalEmptyTupCollected} adet
              {totalEmptyTupLegacyCollected > 0
                ? ` · Eski kayıt ${totalEmptyTupLegacyCollected}`
                : ''}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-indigo-50/50  border border-indigo-200 ">
            <span className="text-[11px] font-semibold text-indigo-700  uppercase">Toplanan Su Sebili</span>
            <div className="text-xl font-bold font-mono text-indigo-700  mt-1">
              {totalEmptySebilCollected} Adet
            </div>
            <span className="text-[10px] text-indigo-600/80">Emanet sebiller (fiyatsız)</span>
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-50/50  border border-emerald-200 ">
            <span className="text-[11px] font-semibold text-emerald-700  uppercase">Nakit Kasa</span>
            <div className="text-xl font-bold font-mono text-emerald-600 mt-1">
              {actualCashInPocket.toLocaleString('tr-TR')} ₺
            </div>
            <span className="text-[10px] text-emerald-600/80">Teslim edilecek nakit para</span>
          </div>

          <div className="p-3.5 rounded-xl bg-indigo-50/50  border border-indigo-200 ">
            <span className="text-[11px] font-semibold text-indigo-700  uppercase">POS Slipleri</span>
            <div className="text-xl font-bold font-mono text-indigo-600 mt-1">
              {actualPosSlipsTotal.toLocaleString('tr-TR')} ₺
            </div>
            <span className="text-[10px] text-indigo-600/80">Banka slip toplamı</span>
          </div>

          <div className="p-3.5 rounded-xl bg-teal-50/50  border border-teal-200 ">
            <span className="text-[11px] font-semibold text-teal-700  uppercase">
              Teslimat Dışı Tahsilat
            </span>
            <div className="text-xl font-bold font-mono text-teal-600 mt-1">
              {standaloneTotal.toLocaleString('tr-TR')} ₺
            </div>
            <span className="text-[10px] text-teal-600/80 break-words">
              Nakit {standaloneCash.toLocaleString('tr-TR')} ₺ · POS{' '}
              {standalonePos.toLocaleString('tr-TR')} ₺
            </span>
          </div>
        </div>

        {cashPosPayments.length > 0 && (
          <div className="rounded-xl border border-slate-200  overflow-hidden">
            <div className="px-3 py-2 bg-slate-50  border-b border-slate-200  text-[11px] font-bold text-slate-700 ">
              Ürün Verilmeden Alınan Tahsilatlar ({cashPosPayments.length})
            </div>
            <div className="divide-y divide-slate-100 ">
              {cashPosPayments.map((payment) => (
                <div
                  key={payment.id}
                  className="px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] min-w-0"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900  break-words">
                      {payment.customerName || payment.customerId}
                    </div>
                    <div className="text-slate-500 break-words">
                      {payment.method === 'CASH' ? 'Nakit' : 'POS'}
                      {payment.note ? ` · ${payment.note}` : ''}
                    </div>
                  </div>
                  <div className="font-mono font-bold text-slate-900  shrink-0 tabular-nums">
                    {(Number(payment.amount) || 0).toLocaleString('tr-TR')} ₺
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Closure Note Input */}
        {!isAlreadyClosed && (
          <div className="pt-2">
            <label className="text-xs font-medium text-slate-600  block mb-1">
              Depoya Teslim & Gün Sonu Kapatma Notu:
            </label>
            <input
              type="text"
              placeholder="Örn: Tüm ürünler depoya eksiksiz indirildi, kasa teslim edildi..."
              value={closureNotes}
              onChange={(e) => setClosureNotes(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-200  text-xs bg-slate-50  "
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
      <div className="bg-white  rounded-2xl border border-slate-200  p-5 shadow-xs space-y-3">
        <h3 className="text-sm font-bold text-slate-900  flex items-center gap-2">
          <Building2 className="w-4 h-4 text-sky-600" />
          <span>Bu Seferdeki Müşteri Teslimatları ({dispatchDeliveries.length} Müşteri)</span>
        </h3>

        <div className="divide-y divide-slate-100  text-xs">
          {dispatchDeliveries.length === 0 ? (
            <div className="p-4 text-center text-slate-400">Bu seferde henüz teslimat yapılmadı.</div>
          ) : (
            dispatchDeliveries.map((del, index) => {
              const isAccount = isAccountCustomerDelivery(del, customers);
              return (
                <div key={del.id} className="py-2.5 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="font-bold text-slate-900  flex items-center gap-2">
                      <span>{index + 1}. {del.customerName}</span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(del.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {del.deliveredItems.map((i) => `${i.quantity} ${i.productName}`).join(' · ')}
                      {del.emptyContainersReceived.damacana > 0 && ` · ${del.emptyContainersReceived.damacana} Boş`}
                      {(del.emptyContainersReceived.camDamacana || 0) > 0 && ` · ${del.emptyContainersReceived.camDamacana} Boş Cam`}
                      {(del.emptyContainersReceived.tupBuyuk || 0) > 0 &&
                        ` · ${del.emptyContainersReceived.tupBuyuk} Büyük Boş Tüp`}
                      {(del.emptyContainersReceived.tupKucuk || 0) > 0 &&
                        ` · ${del.emptyContainersReceived.tupKucuk} Küçük Boş Tüp`}
                      {del.emptyContainersReceived.tup > 0 &&
                        ` · ${del.emptyContainersReceived.tup} Boş Tüp (eski)`}
                    </div>
                  </div>

                  <div className="text-right">
                    {!isAccount && (
                      <div className="font-mono font-bold text-slate-900 ">
                        {del.deliveredGrandTotal.toLocaleString('tr-TR')} ₺
                      </div>
                    )}
                    <div className="text-[10px] text-emerald-600 font-semibold">
                      {del.collectedPayment.cashAmount > 0 && `${del.collectedPayment.cashAmount.toLocaleString('tr-TR')} ₺ Nakit `}
                      {del.collectedPayment.posAmount > 0 && `${del.collectedPayment.posAmount.toLocaleString('tr-TR')} ₺ POS `}
                      {del.collectedPayment.totalCollected === 0 && (isAccount ? 'Tahsilat kaydı yok' : '0 ₺ Veresiye')}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

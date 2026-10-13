import React, { useState } from 'react';
import { Dispatch, Delivery, Product, User } from '../../types';
import {
  CheckCircle2,
  AlertCircle,
  Wallet,
  CreditCard,
  RotateCcw,
  Droplet,
  Printer,
  FileCheck,
  Building2,
  Clock
} from 'lucide-react';
import { closeDispatch } from '../../services/api';

interface EndOfDayViewProps {
  dispatch: Dispatch | null;
  deliveries: Delivery[];
  products: Product[];
  currentUser: User;
  onDispatchUpdated: (updated: Dispatch) => void;
}

export const EndOfDayView: React.FC<EndOfDayViewProps> = ({
  dispatch,
  deliveries,
  products,
  currentUser,
  onDispatchUpdated,
}) => {
  if (!dispatch) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center text-slate-400 text-xs">
        Bugün için aktif bir araç seferi bulunmuyor.
      </div>
    );
  }

  // Filter deliveries belonging to this dispatch
  const dispatchDeliveries = deliveries.filter((d) => d.dispatchId === dispatch.id);

  // Delivered quantities by product
  const deliveredTotals: Record<string, number> = {};
  let totalDeliveredValue = 0;
  let totalCashCollected = 0;
  let totalPosCollected = 0;
  let totalCreditAdded = 0;
  let totalEmptyDamacanaCollected = 0;
  let totalEmptyTupCollected = 0;

  dispatchDeliveries.forEach((del) => {
    totalDeliveredValue += del.deliveredGrandTotal;
    totalCashCollected += del.collectedPayment.cashAmount;
    totalPosCollected += del.collectedPayment.posAmount;
    if (del.collectedPayment.diffUncollected > 0) {
      totalCreditAdded += del.collectedPayment.diffUncollected;
    }
    totalEmptyDamacanaCollected += del.emptyContainersReceived.damacana || 0;
    totalEmptyTupCollected += del.emptyContainersReceived.tup || 0;

    del.deliveredItems.forEach((item) => {
      deliveredTotals[item.productId] = (deliveredTotals[item.productId] || 0) + item.quantity;
    });
  });

  // Calculate expected remaining full items
  const expectedRemainingFull: Record<string, number> = {};
  dispatch.loadedItems.forEach((loaded) => {
    const deliveredCount = deliveredTotals[loaded.productId] || 0;
    expectedRemainingFull[loaded.productId] = Math.max(0, loaded.quantity - deliveredCount);
  });

  // Local state for driver's physical counts
  const [countedFull, setCountedFull] = useState<Record<string, number>>(() => {
    if (dispatch.endOfDayReconciliation) {
      return dispatch.endOfDayReconciliation.remainingFullCounted;
    }
    // Initialize default with expected
    return { ...expectedRemainingFull };
  });

  const [actualCashInput, setActualCashInput] = useState<string>(() =>
    dispatch.endOfDayReconciliation
      ? dispatch.endOfDayReconciliation.actualCashInPocket.toString()
      : totalCashCollected.toString()
  );

  const [actualPosInput, setActualPosInput] = useState<string>(() =>
    dispatch.endOfDayReconciliation
      ? dispatch.endOfDayReconciliation.actualPosSlipsTotal.toString()
      : totalPosCollected.toString()
  );

  const [closureNotes, setClosureNotes] = useState(
    dispatch.endOfDayReconciliation?.notes || ''
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState(false);

  const isAlreadyClosed = dispatch.status === 'completed';

  const handleCloseShift = async () => {
    try {
      setIsSubmitting(true);
      const updated = await closeDispatch(dispatch.id, {
        closedByUserId: currentUser.id,
        closedByUserName: currentUser.name,
        remainingFullCounted: countedFull,
        collectedEmptyDamacana: totalEmptyDamacanaCollected,
        collectedEmptyTup: totalEmptyTupCollected,
        actualCashInPocket: Number(actualCashInput) || 0,
        actualPosSlipsTotal: Number(actualPosInput) || 0,
        notes: closureNotes,
      });

      onDispatchUpdated(updated);
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
    <div className="space-y-6">
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
                Açık Sefer
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Araç: <strong>{dispatch.vehiclePlate}</strong> · Şoför: <strong>{dispatch.driverName}</strong> · Toplam Teslimat: <strong>{dispatchDeliveries.length} Adet</strong>
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

      {/* Grid 1: Dolu ve Boş Ürün Sayım Tablosu */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Droplet className="w-4 h-4 text-sky-600" />
              <span>A. Arabada Kalması Gereken Dolu Ürünler</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Yüklenen - Teslim Edilen = Arabada Bulunması Gereken Sayı
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-semibold">
                <th className="pb-2.5">Ürün Adı</th>
                <th className="pb-2.5 text-center">Yüklenen</th>
                <th className="pb-2.5 text-center">Teslim Edilen</th>
                <th className="pb-2.5 text-center text-sky-600">Olması Gereken</th>
                <th className="pb-2.5 text-center">Fiziki Sayılan</th>
                <th className="pb-2.5 text-right">Durum / Fark</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {dispatch.loadedItems.map((loaded) => {
                const p = products.find((prod) => prod.id === loaded.productId);
                const delivered = deliveredTotals[loaded.productId] || 0;
                const expected = expectedRemainingFull[loaded.productId] || 0;
                const counted = countedFull[loaded.productId] ?? expected;
                const diff = counted - expected;

                return (
                  <tr key={loaded.productId} className="hover:bg-slate-50/50">
                    <td className="py-3 font-semibold text-slate-900 dark:text-white">
                      {p?.name || loaded.productId}
                    </td>
                    <td className="py-3 text-center font-mono font-medium text-slate-600 dark:text-slate-400">
                      {loaded.quantity}
                    </td>
                    <td className="py-3 text-center font-mono font-bold text-sky-600">
                      {delivered}
                    </td>
                    <td className="py-3 text-center font-mono font-extrabold text-sm text-sky-700 dark:text-sky-400">
                      {expected}
                    </td>
                    <td className="py-3 text-center">
                      {isAlreadyClosed ? (
                        <span className="font-mono font-bold">{counted}</span>
                      ) : (
                        <input
                          type="number"
                          value={counted}
                          onChange={(e) =>
                            setCountedFull((prev) => ({
                              ...prev,
                              [loaded.productId]: parseInt(e.target.value) || 0,
                            }))
                          }
                          className="w-16 h-8 rounded-lg border border-slate-200 dark:border-slate-700 text-center font-mono font-bold text-xs"
                        />
                      )}
                    </td>
                    <td className="py-3 text-right font-mono font-bold">
                      {diff === 0 ? (
                        <span className="text-emerald-600">Tam (0)</span>
                      ) : diff > 0 ? (
                        <span className="text-sky-600">+{diff} Fazla</span>
                      ) : (
                        <span className="text-red-600">{diff} Eksik</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Depoya İnecek Boş Kaplar Bölümü */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-bold text-orange-900 dark:text-orange-300 flex items-center gap-2 mb-2">
            <RotateCcw className="w-4 h-4 text-orange-600" />
            <span>B. Toplanıp Depoya İndirilecek Boş Kaplar</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-xl border border-orange-200 bg-orange-50/50 dark:bg-orange-950/20 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  Müşterilerden Toplanan Boş Damacana
                </span>
                <div className="text-xl font-extrabold font-mono text-orange-600 tabular-nums mt-0.5">
                  {totalEmptyDamacanaCollected} Adet
                </div>
              </div>
              <span className="text-xs font-semibold px-2 py-1 rounded bg-orange-100 text-orange-800">
                Depoya Teslim Edilecek
              </span>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 dark:bg-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  Müşterilerden Toplanan Boş Tüp
                </span>
                <div className="text-xl font-extrabold font-mono text-slate-800 dark:text-slate-200 tabular-nums mt-0.5">
                  {totalEmptyTupCollected} Adet
                </div>
              </div>
              <span className="text-xs font-semibold px-2 py-1 rounded bg-slate-200 text-slate-800">
                Depoya Teslim Edilecek
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Grid 2: Fiili Nakit ve POS Kasa Mutabakatı */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-600" />
              <span>C. Fiili Kasa & Tahsilat Mutabakatı</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Şoförün teslim etmesi gereken fiili nakit ve POS slipleri toplamı
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Nakit Kasa */}
          <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
                <Wallet className="w-4 h-4 text-emerald-600" />
                Fiili Nakit Kasa
              </span>
              <span className="text-[11px] text-emerald-700">Sistem: {totalCashCollected} ₺</span>
            </div>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">
                Sayılıp Teslim Edilen Nakit (₺):
              </label>
              {isAlreadyClosed ? (
                <div className="text-2xl font-extrabold font-mono text-emerald-600">
                  {Number(actualCashInput).toLocaleString('tr-TR')} ₺
                </div>
              ) : (
                <input
                  type="number"
                  value={actualCashInput}
                  onChange={(e) => setActualCashInput(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-emerald-300 font-mono font-extrabold text-lg text-emerald-700 bg-white dark:bg-slate-800"
                />
              )}
            </div>
          </div>

          {/* POS Kasa */}
          <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-900 dark:text-indigo-300 flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-indigo-600" />
                POS Slip Toplamı
              </span>
              <span className="text-[11px] text-indigo-700">Sistem: {totalPosCollected} ₺</span>
            </div>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">
                POS Cihazı Gün Sonu Raporu (₺):
              </label>
              {isAlreadyClosed ? (
                <div className="text-2xl font-extrabold font-mono text-indigo-600">
                  {Number(actualPosInput).toLocaleString('tr-TR')} ₺
                </div>
              ) : (
                <input
                  type="number"
                  value={actualPosInput}
                  onChange={(e) => setActualPosInput(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-indigo-300 font-mono font-extrabold text-lg text-indigo-700 bg-white dark:bg-slate-800"
                />
              )}
            </div>
          </div>

          {/* Genel Finansal Toplam */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-2">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
              Günün Ciro Özeti
            </span>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Teslim Edilen Mal:</span>
                <span className="font-mono font-semibold">{totalDeliveredValue.toLocaleString('tr-TR')} ₺</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Cari / Veresiye:</span>
                <span className="font-mono font-semibold text-amber-600">+{totalCreditAdded.toLocaleString('tr-TR')} ₺</span>
              </div>
              <div className="flex justify-between font-bold text-slate-900 dark:text-white pt-1 border-t border-slate-200 dark:border-slate-700">
                <span>Toplam Tahsilat:</span>
                <span className="font-mono text-sm text-emerald-600">
                  {(Number(actualCashInput) + Number(actualPosInput)).toLocaleString('tr-TR')} ₺
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Closure Note Input */}
        {!isAlreadyClosed && (
          <div className="pt-2">
            <label className="text-xs font-medium text-slate-600 block mb-1">
              Mutabakat / Gün Sonu Kapatma Notu:
            </label>
            <input
              type="text"
              placeholder="Örn: 2 adet damacana arızalı kapak tespit edildi, depoya sağlam teslim edildi..."
              value={closureNotes}
              onChange={(e) => setClosureNotes(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800"
            />
          </div>
        )}

        {/* Final Closure Action Button */}
        {!isAlreadyClosed && (
          <div className="pt-3 flex items-center justify-end">
            <button
              onClick={handleCloseShift}
              disabled={isSubmitting}
              className="w-full sm:w-auto px-8 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all"
            >
              <FileCheck className="w-4 h-4" />
              <span>{isSubmitting ? 'Kapatılıyor...' : 'Günü Kapat & Mutabakatı İmzala'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Grid 3: Günlük Müşteri ve Teslimat Listesi Önizleme */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Building2 className="w-4 h-4 text-sky-600" />
          <span>Günün Müşteri Teslimat Karnesi ({dispatchDeliveries.length} Müşteri)</span>
        </h3>

        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          {dispatchDeliveries.length === 0 ? (
            <div className="p-4 text-center text-slate-400">Bugün henüz teslimat yapılmadı.</div>
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
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono font-bold text-slate-900 dark:text-white">
                    {del.deliveredGrandTotal} ₺
                  </div>
                  <div className="text-[10px] text-emerald-600 font-semibold">
                    {del.collectedPayment.cashAmount > 0 && `${del.collectedPayment.cashAmount} ₺ Nakit `}
                    {del.collectedPayment.posAmount > 0 && `${del.collectedPayment.posAmount} ₺ POS `}
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

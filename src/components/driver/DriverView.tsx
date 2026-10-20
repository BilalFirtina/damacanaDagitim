import React, { useEffect, useState } from 'react';
import { Dispatch, Delivery, Customer, Product, User } from '../../types';
import { todayUtcDateStr } from '../../services/dateWindow';
import { cancelDelivery } from '../../services/api';
import { MorningLoadCard } from './MorningLoadCard';
import { DriverStatsStrip } from './DriverStatsStrip';
import { DeliveryModal } from './DeliveryModal';
import {
  Plus,
  Truck,
  RotateCcw,
  CheckCircle2,
  Building2,
  ArrowRight,
  UserCheck,
  Edit2,
  Ban,
  AlertTriangle,
  X
} from 'lucide-react';

interface DriverViewProps {
  currentUser: User;
  users: User[];
  dispatches: Dispatch[];
  currentDispatch: Dispatch | null;
  deliveries: Delivery[];
  customers: Customer[];
  products: Product[];
  onDispatchUpdated: (dispatch: Dispatch) => void;
  onDeliveryCreated: (delivery: Delivery, updatedCustomer?: Customer) => void;
  onDeliveryCorrected: () => void;
  onCustomerCreated?: (customer: Customer) => void;
  onNavigateTab: (tab: any) => void;
}

export const DriverView: React.FC<DriverViewProps> = ({
  currentUser,
  users,
  dispatches,
  currentDispatch: initialDispatch,
  deliveries,
  customers,
  products,
  onDispatchUpdated,
  onDeliveryCreated,
  onDeliveryCorrected,
  onCustomerCreated,
  onNavigateTab,
}) => {
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Delivery | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Delivery | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const openCancelDialog = (delivery: Delivery) => {
    setCancelTarget(delivery);
    setCancelReason('');
    setCancelError(null);
  };

  const closeCancelDialog = () => {
    if (isCancelling) return;
    setCancelTarget(null);
    setCancelReason('');
    setCancelError(null);
  };

  const handleCancelDelivery = async () => {
    if (!cancelTarget || isCancelling) return;
    if (cancelReason.trim().length < 3) {
      setCancelError('İptal için en az 3 karakterlik bir gerekçe girin.');
      return;
    }

    try {
      setIsCancelling(true);
      setCancelError(null);
      await cancelDelivery(cancelTarget.id, cancelReason.trim());
      setCancelTarget(null);
      setCancelReason('');
      onDeliveryCorrected();
    } catch (err: any) {
      setCancelError(err.message || 'Teslimat iptal edilemedi.');
    } finally {
      setIsCancelling(false);
    }
  };

  const drivers = users.filter((u) => u.role === 'driver');

  // If admin (Depo Yöneticisi), allow selecting which driver's vehicle dashboard to inspect
  const [selectedDriverIdForAdmin, setSelectedDriverIdForAdmin] = useState<string>(() => {
    if (currentUser.role === 'admin') {
      return drivers[0]?.id || '';
    }
    return currentUser.id;
  });

  const todayStr = todayUtcDateStr();

  // Active dispatch being viewed: only open dispatches (not completed)
  const activeDispatch =
    currentUser.role === 'admin'
      ? dispatches.find(
          (d) =>
            d.date === todayStr &&
            d.driverId === selectedDriverIdForAdmin &&
            d.status !== 'completed'
        ) || null
      : initialDispatch && initialDispatch.status !== 'completed'
      ? initialDispatch
      : null;

  const inspectedDriverId =
    currentUser.role === 'admin' ? selectedDriverIdForAdmin : currentUser.id;

  // Completed dispatches for this driver today
  const completedDispatchesToday = dispatches.filter(
    (d) =>
      d.date === todayStr &&
      d.driverId === inspectedDriverId &&
      d.status === 'completed'
  );

  // Deliveries made today by this active vehicle
  const myDeliveries = activeDispatch
    ? deliveries.filter((d) => d.dispatchId === activeDispatch.id)
    : [];

  const isShiftReady = activeDispatch && activeDispatch.status === 'in_transit';

  return (
    <div className="space-y-6 w-full max-w-full min-w-0">
      {/* Depo Yöneticisi Quick Monitor Bar */}
      {currentUser.role === 'admin' && (
        <div className="bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-md">
              DY
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-indigo-950 dark:text-indigo-200">
                  Depo Yöneticisi Saha Gözetimi
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-indigo-200/70 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-200">
                  Uğur Fırtına
                </span>
              </div>
              <p className="text-[11px] text-indigo-800/80 dark:text-indigo-300 mt-0.5">
                Şoförlerin canlı araç stok durumlarını izleyebilir, istedikleri araca sabah yüklemesi girebilirsiniz.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label className="text-xs font-bold text-indigo-900 dark:text-indigo-200 whitespace-nowrap flex items-center gap-1">
              <UserCheck className="w-3.5 h-3.5 text-indigo-600" />
              <span>İncelenen Şoför:</span>
            </label>
            <select
              value={selectedDriverIdForAdmin}
              onChange={(e) => setSelectedDriverIdForAdmin(e.target.value)}
              className="w-full min-w-0 max-w-full box-border p-2 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-100 shadow-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            >
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}{(d.isLeadDriver || d.canLoadVehicle) ? ' (Yetkili)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Driver & Vehicle Ready for New Trip Notice (Shown if previous runs are closed) */}
      {!activeDispatch && completedDispatchesToday.length > 0 && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-md">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-emerald-950 dark:text-emerald-200">
                  Önceki Sefer Tamamlandı & Kalan Ürünler Depoya Boşaltıldı
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-200/70 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200">
                  Bugün {completedDispatchesToday.length} Sefer Kapandı
                </span>
              </div>
              <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300 mt-0.5">
                Şoför ve araç yeni bir dağıtım seferi için yükleme almaya tamamen hazırdır. Aşağıdan yeni sefer yüklemesi girebilirsiniz.
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigateTab('eod')}
            className="text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:underline flex items-center gap-1 shrink-0"
          >
            <span>Kapanan Sefer Raporunu İncele</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Morning Warehouse Vehicle Load Card */}
      <MorningLoadCard
        currentDispatch={activeDispatch}
        currentUser={currentUser}
        users={users}
        products={products}
        dispatches={dispatches}
        onDispatchUpdated={onDispatchUpdated}
      />

      {/* Live Vehicle Counters (Dolu Damacana, Boşlar, Nakit, POS) */}
      {activeDispatch && (
        <DriverStatsStrip dispatch={activeDispatch} deliveries={deliveries} products={products} />
      )}

      {/* Primary Action CTA Bar for Driver (depo yöneticisi teslimat yapmaz) */}
      {isShiftReady && currentUser.role !== 'admin' && (
        <div className="bg-gradient-to-r from-sky-600 to-sky-700 rounded-2xl p-4 sm:p-5 text-white shadow-lg shadow-sky-600/20 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h2 className="text-base sm:text-lg font-bold">
              Müşteri Teslimatı Yapmaya Hazır mısınız?
            </h2>
            <p className="text-xs text-sky-100 mt-0.5">
              Müşteriyi seçin, teslim edilen dolu ürünleri ve alınan boş kapları tek tıkla sisteme kaydedin.
            </p>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button
              onClick={() => setShowDeliveryModal(true)}
              className="flex-1 sm:flex-initial px-6 py-3 rounded-xl bg-white text-sky-700 font-extrabold text-xs sm:text-sm hover:bg-sky-50 active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Yeni Teslimat Girişi</span>
            </button>
          </div>
        </div>
      )}

      {/* Today's Deliveries List for this Vehicle */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-sky-600" />
              <span>Günün Yapılan Teslimatları ({myDeliveries.length})</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeDispatch?.vehiclePlate || 'Seçili araç'} ({activeDispatch?.driverName || 'Şoför'}) tarafından bugün tamamlanan teslimatlar
            </p>
            {!isOnline && (
              <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 mt-1">
                Çevrimdışıyken teslimat iptali ve düzenlemesi devre dışıdır.
              </p>
            )}
          </div>

          {activeDispatch && activeDispatch.status === 'in_transit' && (
            <button
              onClick={() => onNavigateTab('eod')}
              className="text-xs font-bold text-sky-600 hover:text-sky-700 flex items-center gap-1"
            >
              <span>Gün Sonu Mutabakatı</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {myDeliveries.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs space-y-2">
            <Truck className="w-8 h-8 text-slate-300 mx-auto" />
            <p>Bugün henüz bu araçla teslimat kaydı yapılmadı.</p>
            {isShiftReady && currentUser.role !== 'admin' && (
              <button
                onClick={() => setShowDeliveryModal(true)}
                className="mt-2 text-xs font-semibold text-sky-600 hover:underline"
              >
                İlk teslimatı şimdi kaydedin →
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {myDeliveries.map((del) => {
              const timeStr = new Date(del.timestamp).toLocaleTimeString('tr-TR', {
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div key={del.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 w-full min-w-0">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-xs text-slate-900 dark:text-white break-words">
                        {del.customerName}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {timeStr}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      {del.deliveredItems.map((item, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px]"
                        >
                          <strong>{item.quantity}</strong> {item.productName} ({item.unitPrice} ₺)
                        </span>
                      ))}

                      {del.emptyContainersReceived.damacana > 0 && (
                        <span className="text-[11px] font-semibold text-orange-600 flex items-center gap-0.5">
                          <RotateCcw className="w-3 h-3" />
                          {del.emptyContainersReceived.damacana} Boş Alındı
                        </span>
                      )}

                      {(del.emptyContainersReceived.camDamacana || 0) > 0 && (
                        <span className="text-[11px] font-semibold text-amber-600 flex items-center gap-0.5">
                          <RotateCcw className="w-3 h-3" />
                          {del.emptyContainersReceived.camDamacana} Boş Cam Alındı
                        </span>
                      )}

                      {del.emptyContainersReceived.tup > 0 && (
                        <span className="text-[11px] font-semibold text-slate-600 flex items-center gap-0.5">
                          <RotateCcw className="w-3 h-3" />
                          {del.emptyContainersReceived.tup} Boş Tüp Alındı
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-left sm:text-right shrink-0">
                    <div className="font-mono font-extrabold text-sm text-slate-900 dark:text-white">
                      {del.deliveredGrandTotal.toLocaleString('tr-TR')} ₺
                    </div>
                    <div className="flex items-center sm:justify-end gap-1.5 text-[11px] font-semibold">
                      {del.collectedPayment.cashAmount > 0 && (
                        <span className="text-emerald-600">
                          {del.collectedPayment.cashAmount.toLocaleString('tr-TR')} ₺ Nakit
                        </span>
                      )}
                      {del.collectedPayment.posAmount > 0 && (
                        <span className="text-indigo-600">
                          {del.collectedPayment.posAmount.toLocaleString('tr-TR')} ₺ POS
                        </span>
                      )}
                      {del.collectedPayment.totalCollected === 0 && (
                        <span className="text-amber-600">Tahsilat Alınmadı (Cari)</span>
                      )}
                    </div>

                    {activeDispatch?.status === 'in_transit' &&
                      currentUser.role !== 'admin' && (
                        <div className="flex items-center sm:justify-end gap-1.5 mt-2">
                          <button
                            type="button"
                            onClick={() => setEditTarget(del)}
                            disabled={!isOnline}
                            title={
                              isOnline
                                ? 'Teslimatı düzenle'
                                : 'Çevrimdışıyken düzenleme yapılamaz'
                            }
                            className="px-2.5 py-1.5 rounded-lg border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 text-[11px] font-bold hover:bg-sky-50 dark:hover:bg-sky-950 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                          >
                            <Edit2 className="w-3 h-3" />
                            Düzenle
                          </button>
                          <button
                            type="button"
                            onClick={() => openCancelDialog(del)}
                            disabled={!isOnline}
                            title={
                              isOnline
                                ? 'Teslimatı iptal et'
                                : 'Çevrimdışıyken iptal yapılamaz'
                            }
                            className="px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-[11px] font-bold hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                          >
                            <Ban className="w-3 h-3" />
                            İptal
                          </button>
                        </div>
                      )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delivery Entry Modal (yalnızca şoför) */}
      {activeDispatch && currentUser.role !== 'admin' && (
        <>
          <DeliveryModal
            isOpen={showDeliveryModal && !editTarget}
            onClose={() => setShowDeliveryModal(false)}
            dispatch={activeDispatch}
            currentUser={currentUser}
            customers={customers}
            products={products}
            onDeliveryCreated={onDeliveryCreated}
            onCustomerCreated={onCustomerCreated}
          />
          <DeliveryModal
            isOpen={!!editTarget}
            onClose={() => setEditTarget(null)}
            dispatch={activeDispatch}
            currentUser={currentUser}
            customers={customers}
            products={products}
            editDelivery={editTarget}
            onDeliveryCreated={onDeliveryCreated}
            onDeliveryUpdated={() => {
              setEditTarget(null);
              onDeliveryCorrected();
            }}
            onCustomerCreated={onCustomerCreated}
          />
        </>
      )}

      {cancelTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 bg-black/60 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-delivery-title"
            className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col border border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-rose-100 dark:bg-rose-950/50 text-rose-600 dark:text-rose-300 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3
                    id="cancel-delivery-title"
                    className="text-sm font-bold text-slate-900 dark:text-white"
                  >
                    Teslimatı İptal Et
                  </h3>
                  <p className="text-xs text-slate-500 break-words">
                    {cancelTarget.customerName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeCancelDialog}
                disabled={isCancelling}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                aria-label="Kapat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 overflow-y-auto">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Teslimat Tutarı</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">
                    {cancelTarget.deliveredGrandTotal.toLocaleString('tr-TR')} ₺
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Tahsilat</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">
                    {cancelTarget.collectedPayment.totalCollected.toLocaleString('tr-TR')} ₺
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-400">
                Cari bakiye ve boş kap bakiyeleri geri alınır. Bu işlem geri
                alınamaz ve denetim kaydına yazılır.
              </p>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  İptal Gerekçesi *
                </label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows={3}
                  minLength={3}
                  placeholder="Örn: Teslimat yanlış müşteriye kaydedildi."
                  className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white resize-y"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  En az 3 karakter.
                </p>
              </div>

              {cancelError && (
                <p className="text-xs font-semibold text-rose-600 bg-rose-50 dark:bg-rose-950/30 rounded-lg p-2 break-words">
                  {cancelError}
                </p>
              )}
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button
                type="button"
                onClick={closeCancelDialog}
                disabled={isCancelling}
                className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleCancelDelivery}
                disabled={isCancelling || cancelReason.trim().length < 3}
                className="px-4 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                <Ban className="w-3.5 h-3.5" />
                {isCancelling ? 'İptal Ediliyor...' : 'Teslimatı İptal Et'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

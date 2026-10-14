import React, { useState } from 'react';
import { Dispatch, Delivery, Customer, Product, User } from '../../types';
import { MorningLoadCard } from './MorningLoadCard';
import { DriverStatsStrip } from './DriverStatsStrip';
import { DeliveryModal } from './DeliveryModal';
import {
  Plus,
  Truck,
  RotateCcw,
  CheckCircle2,
  Wallet,
  CreditCard,
  Building2,
  Clock,
  ArrowRight,
  UserCheck
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
  onNavigateTab,
}) => {
  const [showDeliveryModal, setShowDeliveryModal] = useState(false);

  const drivers = users.filter((u) => u.role === 'driver');

  // If admin (Depo Yöneticisi), allow selecting which driver's vehicle dashboard to inspect
  const [selectedDriverIdForAdmin, setSelectedDriverIdForAdmin] = useState<string>(() => {
    if (currentUser.role === 'admin') {
      return drivers[0]?.id || '';
    }
    return currentUser.id;
  });

  const todayStr = new Date().toISOString().split('T')[0];

  // Active dispatch being viewed
  const activeDispatch =
    currentUser.role === 'admin'
      ? dispatches.find((d) => d.date === todayStr && d.driverId === selectedDriverIdForAdmin) || null
      : initialDispatch;

  const activeDriver =
    currentUser.role === 'admin'
      ? drivers.find((d) => d.id === selectedDriverIdForAdmin)
      : currentUser;

  // Deliveries made today by this active vehicle
  const myDeliveries = activeDispatch
    ? deliveries.filter((d) => d.dispatchId === activeDispatch.id)
    : [];

  const isShiftReady = activeDispatch && activeDispatch.status === 'in_transit';

  return (
    <div className="space-y-6">
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
              className="p-2 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-100 shadow-xs focus:ring-2 focus:ring-indigo-500"
            >
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} {d.isLeadDriver ? '★ (Tek Yetkili)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Morning Warehouse Vehicle Load Card */}
      <MorningLoadCard
        currentDispatch={activeDispatch}
        currentUser={currentUser}
        users={users}
        products={products}
        onDispatchUpdated={onDispatchUpdated}
      />

      {/* Live Vehicle Counters (Dolu Damacana, Boşlar, Nakit, POS) */}
      {activeDispatch && (
        <DriverStatsStrip dispatch={activeDispatch} deliveries={deliveries} products={products} />
      )}

      {/* Primary Action CTA Bar for Driver */}
      {isShiftReady && (
        <div className="bg-gradient-to-r from-sky-600 to-sky-700 rounded-2xl p-4 sm:p-5 text-white shadow-lg shadow-sky-600/20 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h2 className="text-base sm:text-lg font-bold">
              {currentUser.role === 'admin'
                ? `${activeDriver?.name || 'Şoför'} için Teslimat Girişi`
                : 'Müşteri Teslimatı Yapmaya Hazır mısınız?'}
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
            {isShiftReady && (
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
                <div key={del.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-slate-900 dark:text-white">
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
                          <RotateCcw className="w-3 back-3" />
                          {del.emptyContainersReceived.damacana} Boş Alındı
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
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delivery Entry Modal */}
      {activeDispatch && (
        <DeliveryModal
          isOpen={showDeliveryModal}
          onClose={() => setShowDeliveryModal(false)}
          dispatch={activeDispatch}
          currentUser={currentUser}
          customers={customers}
          products={products}
          onDeliveryCreated={onDeliveryCreated}
        />
      )}
    </div>
  );
};

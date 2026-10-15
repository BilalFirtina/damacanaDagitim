import React, { useState } from 'react';
import { Dispatch, Product, User, AUTHORIZED_VEHICLE_PLATES } from '../../types';
import { CheckCircle2, PackageCheck, Truck, Plus, Check, UserCheck, ShieldCheck, AlertCircle } from 'lucide-react';
import { confirmDispatch, createDispatch } from '../../services/api';

interface MorningLoadCardProps {
  currentDispatch: Dispatch | null;
  currentUser: User;
  users: User[];
  products: Product[];
  dispatches?: Dispatch[];
  onDispatchUpdated: (updatedDispatch: Dispatch) => void;
}

export const MorningLoadCard: React.FC<MorningLoadCardProps> = ({
  currentDispatch,
  currentUser,
  users,
  products,
  dispatches = [],
  onDispatchUpdated,
}) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [showManualLoadModal, setShowManualLoadModal] = useState(false);

  // Active dispatches (not completed)
  const activeDispatches = dispatches.filter((d) => d.status !== 'completed');
  const busyPlates = new Set(activeDispatches.map((d) => d.vehiclePlate));
  const busyDriverIds = new Set(activeDispatches.map((d) => d.driverId));

  // Vehicle plates currently available (not in active distribution)
  const availablePlates = AUTHORIZED_VEHICLE_PLATES.filter((plate) => !busyPlates.has(plate));

  // List of actual drivers (excludes Depo Yöneticisi / Admin)
  const drivers = users.filter((u) => u.role === 'driver');

  // Initial driver selection: currentUser if driver, else first available driver
  const [selectedDriverId, setSelectedDriverId] = useState<string>(() => {
    if (currentUser.role === 'driver') return currentUser.id;
    const availableDriver = drivers.find((d) => !busyDriverIds.has(d.id));
    return availableDriver?.id || drivers[0]?.id || '';
  });

  // Independent vehicle plate selection (default to first available plate)
  const [selectedPlate, setSelectedPlate] = useState<string>(() => {
    return availablePlates[0] || AUTHORIZED_VEHICLE_PLATES[0];
  });

  const [loadQuantities, setLoadQuantities] = useState<Record<string, number>>({});
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Depo Yöneticisi (Admin) and Tek Yetkili Şoför (canLoadVehicle === true) can load vehicles
  const canUserLoad = currentUser.role === 'admin' || currentUser.canLoadVehicle;

  const handleOpenLoadModal = () => {
    // Set appropriate initial driver
    if (currentUser.role === 'driver') {
      setSelectedDriverId(currentUser.id);
    } else {
      const firstAvailable = drivers.find((d) => !busyDriverIds.has(d.id));
      if (firstAvailable) {
        setSelectedDriverId(firstAvailable.id);
      } else if (drivers.length > 0 && !selectedDriverId) {
        setSelectedDriverId(drivers[0].id);
      }
    }
    // Set available plate
    if (availablePlates.length > 0 && (!selectedPlate || busyPlates.has(selectedPlate))) {
      setSelectedPlate(availablePlates[0]);
    }
    setLoadingError(null);
    setShowManualLoadModal(true);
  };

  const handleConfirmLoad = async () => {
    if (!currentDispatch) return;
    try {
      setIsConfirming(true);
      const updated = await confirmDispatch(currentDispatch.id);
      onDispatchUpdated(updated);
    } catch (err: any) {
      alert(err.message || 'Onay verilemedi');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleSaveManualLoad = async () => {
    if (!selectedDriverId) {
      setLoadingError('Lütfen ürünlerin yüklendiği şoförü seçiniz.');
      return;
    }

    if (!selectedPlate) {
      setLoadingError('Lütfen araç plakasını seçiniz.');
      return;
    }

    if (busyPlates.has(selectedPlate)) {
      setLoadingError(`Seçilen araç (${selectedPlate}) halen aktif bir dağıtımda kullanılmaktadır. Önceki seferin bitiş raporu alınmadan bu araç seçilemez.`);
      return;
    }

    if (busyDriverIds.has(selectedDriverId)) {
      setLoadingError('Seçilen şoför halen aktif bir dağıtım seferindedir. Önceki sefer tamamlanmadan yeni sefer açılamaz.');
      return;
    }

    const items = Object.entries(loadQuantities)
      .filter(([_, q]) => q > 0)
      .map(([productId, quantity]) => ({ productId, quantity }));

    if (items.length === 0) {
      setLoadingError('En az bir ürün için sıfırdan büyük adet girmelisiniz.');
      return;
    }

    try {
      setIsSaving(true);
      setLoadingError(null);

      const targetDriver = users.find((u) => u.id === selectedDriverId);
      const isSelfLoad = selectedDriverId === currentUser.id;

      const loaderRoleTitle =
        currentUser.role === 'admin'
          ? 'Depo Yöneticisi'
          : currentUser.isLeadDriver || currentUser.canLoadVehicle
          ? 'Tek Yetkili Şoför'
          : 'Depocu';

      const newDisp = await createDispatch({
        driverId: selectedDriverId,
        vehiclePlate: selectedPlate,
        loadedItems: items,
        loadedByUserId: currentUser.id,
        loadedByUserName: `${currentUser.name} (${loaderRoleTitle})`,
        // If driver is loading his own vehicle, auto-confirm. If loading for another driver, require inspection
        driverConfirmed: isSelfLoad,
      });

      onDispatchUpdated(newDisp);
      setShowManualLoadModal(false);
      setLoadQuantities({});
    } catch (err: any) {
      setLoadingError(err.message || 'Yükleme kaydedilemedi');
    } finally {
      setIsSaving(false);
    }
  };

  // Render the modal for manual load input
  const renderLoadModal = () => {
    if (!showManualLoadModal) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[92vh] flex flex-col">
          {/* Modal Header */}
          <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-slate-900 dark:text-white">
                  Sabah Depo Yükleme Girişi
                </span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                  {currentUser.role === 'admin' ? 'Depo Yöneticisi' : 'Tek Yetkili Şoför'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Yüklemeyi Yapan: <strong className="text-slate-800 dark:text-slate-200">{currentUser.name}</strong>
              </p>
            </div>
            <button
              onClick={() => setShowManualLoadModal(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg font-bold p-1 rounded-lg"
              title="Kapat"
            >
              ✕
            </button>
          </div>

          {loadingError && (
            <div className="mt-3 p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-xs font-semibold flex items-center gap-2 shrink-0">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{loadingError}</span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto pr-1 mt-4 space-y-4">
            {/* Independent Driver & Plate Selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80">
              {/* 1. Driver Selection (Independent) */}
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-sky-600" />
                  <span>Şoför Seçimi</span>
                </label>
                <select
                  value={selectedDriverId}
                  onChange={(e) => setSelectedDriverId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500"
                >
                  {drivers.map((d) => {
                    const isBusy = busyDriverIds.has(d.id);
                    return (
                      <option
                        key={d.id}
                        value={d.id}
                        disabled={isBusy}
                        className={isBusy ? 'text-slate-400 dark:text-slate-500' : ''}
                      >
                        {d.name} {d.isLeadDriver ? '★ (Yetkili)' : ''}{' '}
                        {isBusy ? '(Aktif Dağıtımda - Seçilemez)' : '(Müsait)'}
                      </option>
                    );
                  })}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  İş yeri sahibi şoför değildir; sadece saha şoförleri listelenir.
                </p>
              </div>

              {/* 2. Vehicle Plate Selection (Excludes vehicles currently in active distribution) */}
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Truck className="w-4 h-4 text-emerald-600" />
                  <span>Araç Plakası</span>
                </label>
                <select
                  value={selectedPlate}
                  onChange={(e) => setSelectedPlate(e.target.value)}
                  disabled={availablePlates.length === 0}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                >
                  {availablePlates.length === 0 ? (
                    <option value="" disabled>
                      Tüm araçlar şu anda aktif dağıtımdadır
                    </option>
                  ) : (
                    availablePlates.map((plate) => (
                      <option key={plate} value={plate}>
                        {plate} (Müsait)
                      </option>
                    ))
                  )}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  {availablePlates.length === 0
                    ? 'Tüm araçlar dağıtımdadır; bitiş raporu verilmeden seçilemez.'
                    : 'Aktif dağıtımdaki araçlar listede görünmez; yalnızca müsait araçlar seçilebilir.'}
                </p>
              </div>
            </div>

            {/* Product Quantities */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  Araca Yüklenen Ürünler & Adetler
                </span>
                <span className="text-[11px] text-slate-400">Damacana, pet, bardak vb.</span>
              </div>

              <div className="space-y-2">
                {products.map((p) => {
                  const currentQty = loadQuantities[p.id] || 0;
                  const step = p.category === 'damacana' ? 5 : 1;

                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800"
                    >
                      <div className="pr-2">
                        <div className="text-xs font-bold text-slate-900 dark:text-white">{p.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {p.unit} · {p.isDeposit ? 'Depozitolu' : 'Tek Yön'} · {p.defaultUnitPrice} ₺
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setLoadQuantities((prev) => ({
                              ...prev,
                              [p.id]: Math.max(0, currentQty - step),
                            }))
                          }
                          className="w-8 h-8 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center text-sm active:scale-90"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          value={currentQty === 0 ? '' : currentQty}
                          onChange={(e) =>
                            setLoadQuantities((prev) => ({
                              ...prev,
                              [p.id]: Math.max(0, parseInt(e.target.value) || 0),
                            }))
                          }
                          placeholder="0"
                          className="w-16 h-8 rounded-lg border border-slate-200 dark:border-slate-700 text-center font-bold font-mono text-xs dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setLoadQuantities((prev) => ({
                              ...prev,
                              [p.id]: currentQty + step,
                            }))
                          }
                          className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400 font-bold flex items-center justify-center text-sm active:scale-90"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Modal Actions */}
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setShowManualLoadModal(false)}
              className="w-1/2 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSaveManualLoad}
              className="w-1/2 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-95 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5"
            >
              {isSaving ? (
                <span>Kaydediliyor...</span>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Yüklemeyi Sisteme Kaydet</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Case 1: No dispatch exists for this driver/vehicle today
  if (!currentDispatch) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs mb-6 w-full max-w-full min-w-0">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Truck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Sabah Depo Yüklemesi Bekleniyor
                </h3>
                {currentUser.role === 'admin' && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                    Depo Yöneticisi Paneli
                  </span>
                )}
                {currentUser.canLoadVehicle && currentUser.role === 'driver' && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                    Tek Yetkili Şoför
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {currentUser.role === 'admin'
                  ? 'Depo Yöneticisi olarak bağımsız şoför ve plaka seçerek araç yüklemelerini sisteme girebilirsiniz.'
                  : currentUser.canLoadVehicle
                  ? 'Tek Yetkili Şoför yetkiniz bulunuyor. Kendi aracınız veya diğer şoförlerin araçları için yükleme girebilirsiniz.'
                  : 'Yöneticiniz veya yetkili şoför aracınıza yükleme girdiğinde burada teslim alma onayı belirecektir.'}
              </p>
            </div>
          </div>

          {canUserLoad && (
            <button
              onClick={handleOpenLoadModal}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Yükleme Adetlerini Gir</span>
            </button>
          )}
        </div>

        {renderLoadModal()}
      </div>
    );
  }

  // Case 2: Dispatch exists and is pending driver confirmation
  if (currentDispatch.status === 'pending_confirmation') {
    const isTargetDriver = currentUser.id === currentDispatch.driverId;

    return (
      <div className="bg-amber-50/70 dark:bg-amber-950/30 rounded-2xl border-2 border-amber-300 dark:border-amber-800 p-4 sm:p-5 shadow-sm mb-6 w-full max-w-full min-w-0">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-md">
              <PackageCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200">
                  Teslim Alma Onayı Bekliyor
                </span>
                <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                  Yükleyen: {currentDispatch.loadedByUserName}
                </span>
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mt-1">
                {currentDispatch.driverName} için Sabah Yüklemesi Girildi ({currentDispatch.vehiclePlate})
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                {isTargetDriver
                  ? 'Lütfen aracınızdaki ürün adetlerini fiziki olarak sayarak kontrol ediniz. Sayım doğruysa onaylayarak sefere başlayabilirsiniz.'
                  : `Yükleme sisteme işlendi. ${currentDispatch.driverName} sayımı kontrol ettikten sonra sefere başlayacaktır.`}
              </p>
            </div>
          </div>

          {canUserLoad && (
            <button
              onClick={handleOpenLoadModal}
              className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 font-semibold text-xs flex items-center gap-1.5 shadow-xs shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Yeni Araç Yüklemesi Gir</span>
            </button>
          )}
        </div>

        {/* Loaded Items Grid */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {currentDispatch.loadedItems.map((item) => {
            const product = products.find((p) => p.id === item.productId);
            return (
              <div
                key={item.productId}
                className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-amber-200 dark:border-amber-800 shadow-xs flex flex-col"
              >
                <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {product?.name || item.productId}
                </span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">
                    {item.quantity}
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium">{product?.unit || 'Adet'}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Driver Confirmation Button (Target Driver or Admin override) */}
        {(isTargetDriver || currentUser.role === 'admin') && (
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              onClick={handleConfirmLoad}
              disabled={isConfirming}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {isConfirming
                  ? 'Onaylanıyor...'
                  : isTargetDriver
                  ? 'Sayımı Kontrol Ettim & Aracı Teslim Alıyorum'
                  : 'Yönetici Olarak Onayla & Sefere Başlat'}
              </span>
            </button>
          </div>
        )}

        {renderLoadModal()}
      </div>
    );
  }

  // Case 3: Dispatch is active (in_transit or completed)
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs mb-6 w-full max-w-full min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center shrink-0">
            <Check className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                Aktif Sefer: {currentDispatch.vehiclePlate} ({currentDispatch.driverName})
              </span>
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded-md">
                Saha Dağıtımında
              </span>
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              Yükleyen: {currentDispatch.loadedByUserName} · Teslim Alan: {currentDispatch.driverName}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {canUserLoad && (
            <button
              onClick={handleOpenLoadModal}
              className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 text-sky-700 dark:text-sky-400 border border-slate-200 dark:border-slate-700 font-semibold text-xs flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Yeni Yükleme Gir</span>
            </button>
          )}

          <div className="text-xs text-slate-500">
            Tarih: <span className="font-semibold text-slate-700 dark:text-slate-300">{currentDispatch.date}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 overflow-x-auto py-1 scrollbar-none text-xs w-full max-w-full">
        <span className="text-slate-400 text-[11px] font-medium whitespace-nowrap">Yüklenenler:</span>
        {currentDispatch.loadedItems.map((item) => {
          const product = products.find((p) => p.id === item.productId);
          return (
            <span
              key={item.productId}
              className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 whitespace-nowrap text-[11px]"
            >
              {product?.name.split(' ')[0]}: <strong className="font-mono tabular-nums">{item.quantity}</strong> {product?.unit}
            </span>
          );
        })}
      </div>

      {renderLoadModal()}
    </div>
  );
};

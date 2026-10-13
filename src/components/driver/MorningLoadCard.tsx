import React, { useState } from 'react';
import { Dispatch, Product, User } from '../../types';
import { CheckCircle2, AlertCircle, PackageCheck, Truck, Plus, Check } from 'lucide-react';
import { confirmDispatch, createDispatch } from '../../services/api';

interface MorningLoadCardProps {
  currentDispatch: Dispatch | null;
  currentUser: User;
  products: Product[];
  onDispatchUpdated: (updatedDispatch: Dispatch) => void;
}

export const MorningLoadCard: React.FC<MorningLoadCardProps> = ({
  currentDispatch,
  currentUser,
  products,
  onDispatchUpdated,
}) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [showManualLoadModal, setShowManualLoadModal] = useState(false);
  const [loadQuantities, setLoadQuantities] = useState<Record<string, number>>({});
  const [loadingError, setLoadingError] = useState<string | null>(null);

  const canUserLoad = currentUser.role === 'admin' || currentUser.canLoadVehicle;

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
    const items = Object.entries(loadQuantities)
      .filter(([_, q]) => q > 0)
      .map(([productId, quantity]) => ({ productId, quantity }));

    if (items.length === 0) {
      setLoadingError('En az bir ürün miktarı girmelisiniz');
      return;
    }

    try {
      setLoadingError(null);
      const newDisp = await createDispatch({
        driverId: currentUser.id,
        vehiclePlate: currentUser.assignedPlate || '34 SU 101',
        loadedItems: items,
        loadedByUserId: currentUser.id,
        loadedByUserName: currentUser.name,
        driverConfirmed: true, // Auto confirmed by creator
      });
      onDispatchUpdated(newDisp);
      setShowManualLoadModal(false);
    } catch (err: any) {
      setLoadingError(err.message || 'Yükleme kaydedilemedi');
    }
  };

  // Case 1: No dispatch exists for this vehicle today
  if (!currentDispatch) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs mb-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Truck className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Sabah Depo Yüklemesi Bekleniyor
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {canUserLoad
                  ? 'Yetkiniz bulunuyor. Depodan araca yüklediğiniz ürünleri şimdi sisteme girebilirsiniz.'
                  : 'Yöneticiniz veya yetkili depocu yükleme adetlerini sisteme girdiğinde burada belirecektir.'}
              </p>
            </div>
          </div>

          {canUserLoad && (
            <button
              onClick={() => setShowManualLoadModal(true)}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Yükleme Adetlerini Gir</span>
            </button>
          )}
        </div>

        {/* Modal for authorized load entry */}
        {showManualLoadModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Sabah Depo Yükleme Girişi</h3>
                  <p className="text-xs text-slate-500">Araç: {currentUser.assignedPlate || '34 SU 101'}</p>
                </div>
                <button
                  onClick={() => setShowManualLoadModal(false)}
                  className="text-slate-400 hover:text-slate-600 text-lg font-bold"
                >
                  ✕
                </button>
              </div>

              {loadingError && (
                <div className="mt-3 p-2.5 rounded-lg bg-red-50 text-red-700 text-xs font-medium">
                  {loadingError}
                </div>
              )}

              <div className="mt-4 space-y-3">
                {products.map((p) => {
                  const currentQty = loadQuantities[p.id] || 0;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-900 dark:text-white">{p.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {p.unit} · {p.isDeposit ? 'Depozitolu' : 'Tek Yön'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setLoadQuantities((prev) => ({
                              ...prev,
                              [p.id]: Math.max(0, currentQty - (p.category === 'damacana' ? 5 : 1)),
                            }))
                          }
                          className="w-9 h-9 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center text-sm active:scale-90"
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
                          className="w-16 h-9 rounded-lg border border-slate-200 dark:border-slate-700 text-center font-bold font-mono text-sm dark:bg-slate-800 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setLoadQuantities((prev) => ({
                              ...prev,
                              [p.id]: currentQty + (p.category === 'damacana' ? 5 : 1),
                            }))
                          }
                          className="w-9 h-9 rounded-lg bg-sky-50 dark:bg-sky-950 text-sky-600 font-bold flex items-center justify-center text-sm active:scale-90"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowManualLoadModal(false)}
                  className="w-1/2 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium text-xs hover:bg-slate-50"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={handleSaveManualLoad}
                  className="w-1/2 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold text-xs shadow-md"
                >
                  Yüklemeyi Kaydet & Başlat
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Case 2: Dispatch exists and is pending driver confirmation
  if (currentDispatch.status === 'pending_confirmation') {
    return (
      <div className="bg-amber-50/70 dark:bg-amber-950/30 rounded-2xl border-2 border-amber-300 dark:border-amber-800 p-5 shadow-sm mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-md">
              <PackageCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200">
                  Teslim Alma Onayı Bekliyor
                </span>
                <span className="text-xs text-slate-500">
                  Yükleyen: {currentDispatch.loadedByUserName}
                </span>
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mt-1">
                Günün Araç Yüklemesi Sisteme Girildi ({currentDispatch.vehiclePlate})
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                Lütfen aracınızdaki ürün adetlerini fiziki olarak sayarak kontrol ediniz. Sayım doğruysa onaylayarak sefere başlayabilirsiniz.
              </p>
            </div>
          </div>
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

        {/* Prominent Driver Confirmation Button */}
        <div className="mt-5 flex items-center justify-end">
          <button
            onClick={handleConfirmLoad}
            disabled={isConfirming}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isConfirming ? 'Onaylanıyor...' : 'Sayımı Kontrol Ettim & Aracı Teslim Alıyorum'}</span>
          </button>
        </div>
      </div>
    );
  }

  // Case 3: Dispatch is in progress (in_transit)
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center">
            <Check className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900 dark:text-white">
                Aktif Sefer: {currentDispatch.vehiclePlate}
              </span>
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded-md">
                Saha Dağıtımında
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              Yükleyen: {currentDispatch.loadedByUserName} · Teslim Alan: {currentDispatch.driverName}
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-500">
          Tarih: <span className="font-semibold text-slate-700 dark:text-slate-300">{currentDispatch.date}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 overflow-x-auto py-1 scrollbar-none text-xs">
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
    </div>
  );
};

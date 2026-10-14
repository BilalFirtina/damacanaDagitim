import React, { useState } from 'react';
import { Dispatch, Product, User, AUTHORIZED_VEHICLE_PLATES } from '../../types';
import {
  Truck,
  Plus,
  ShieldCheck,
  CheckCircle2,
  Clock,
  UserCheck,
  UserX,
  Package,
  Layers
} from 'lucide-react';
import { createDispatch, updateUser } from '../../services/api';

interface VehicleLoadManagementProps {
  dispatches: Dispatch[];
  users: User[];
  products: Product[];
  currentUser: User;
  onDispatchCreated: (dispatch: Dispatch) => void;
  onUsersUpdated: (users: User[]) => void;
}

export const VehicleLoadManagement: React.FC<VehicleLoadManagementProps> = ({
  dispatches,
  users,
  products,
  currentUser,
  onDispatchCreated,
  onUsersUpdated,
}) => {
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');
  const [selectedPlate, setSelectedPlate] = useState<string>(AUTHORIZED_VEHICLE_PLATES[0]);
  const [loadQuantities, setLoadQuantities] = useState<Record<string, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const drivers = users.filter((u) => u.role === 'driver');

  const handleToggleLoadPermission = async (driver: User) => {
    try {
      const updated = await updateUser(driver.id, {
        canLoadVehicle: !driver.canLoadVehicle,
      });
      onUsersUpdated(users.map((u) => (u.id === driver.id ? updated : u)));
    } catch (err: any) {
      alert(err.message || 'Yetki güncellenemedi');
    }
  };

  const handleCreateLoad = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDriverId) {
      setErrorMsg('Lütfen bir şoför seçiniz');
      return;
    }

    const items = Object.entries(loadQuantities)
      .filter(([_, q]) => q > 0)
      .map(([productId, quantity]) => ({ productId, quantity }));

    if (items.length === 0) {
      setErrorMsg('En az bir ürün miktarı girmelisiniz');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);

      const driver = users.find((u) => u.id === selectedDriverId)!;
      const plate = selectedPlate || AUTHORIZED_VEHICLE_PLATES[0];

      const created = await createDispatch({
        driverId: driver.id,
        vehiclePlate: plate,
        loadedItems: items,
        loadedByUserId: currentUser.id,
        loadedByUserName: `${currentUser.name} (Depo Yöneticisi)`,
        driverConfirmed: false, // Standard driver must inspect & confirm
      });

      onDispatchCreated(created);
      setShowLoadModal(false);
      setSelectedDriverId('');
      setSelectedPlate(AUTHORIZED_VEHICLE_PLATES[0]);
      setLoadQuantities({});
    } catch (err: any) {
      setErrorMsg(err.message || 'Yükleme oluşturulamadı');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 w-full max-w-full min-w-0">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4 w-full max-w-full">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Truck className="w-5 h-5 text-indigo-600" />
            <span>Depo Araç Yükleme Yönetimi & Şoför Yetkilendirme</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Sadece yöneticinin veya yetki verdiği şoförlerin yükleme girebilmesi kuralı buradan yönetilir
          </p>
        </div>

        <button
          onClick={() => setShowLoadModal(true)}
          className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-all whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>Araca Sabah Yüklemesi Gir</span>
        </button>
      </div>

      {/* Driver Loading Permission Management Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Şoför Depo Yükleme Yetkileri (canLoadVehicle)
            </h3>
            <p className="text-[11px] text-slate-500">
              Yetkisi olmayan şoförler sabah sadece yüklenen adetleri kontrol edip teslim alma onayı verebilir.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {drivers.map((driver) => (
            <div
              key={driver.id}
              className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between"
            >
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <span>{driver.name}</span>
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  {driver.assignedPlate || 'Araçsız'} · {driver.phone || 'Tel yok'}
                </div>
                <div className="text-[11px] font-semibold mt-1">
                  {driver.canLoadVehicle ? (
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> Yükleme Yetkisi Var
                    </span>
                  ) : (
                    <span className="text-slate-400">Yükleme Yetkisi Yok (Onaycı)</span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleToggleLoadPermission(driver)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 ${
                  driver.canLoadVehicle
                    ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
                    : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200'
                }`}
              >
                {driver.canLoadVehicle ? 'Yetkiyi Kaldır' : 'Yetki Ver'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Today's Dispatches / Vehicle Loads Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
        <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
          Günün Sefer ve Araç Yüklemeleri ({dispatches.length} Araç)
        </h3>

        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
          {dispatches.map((disp) => (
            <div key={disp.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white">
                    {disp.vehiclePlate}
                  </span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{disp.driverName}</span>
                  {disp.status === 'in_transit' ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      Şoför Onayladı (Sahada)
                    </span>
                  ) : disp.status === 'pending_confirmation' ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                      Şoför Sayım Onayı Bekliyor
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800">
                      Günü Kapatıldı
                    </span>
                  )}
                </div>

                <div className="text-[11px] text-slate-500">
                  Yükleyen: <strong>{disp.loadedByUserName}</strong>
                  {disp.driverConfirmedAt && ` · Onay Zamanı: ${new Date(disp.driverConfirmedAt).toLocaleTimeString('tr-TR')}`}
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {disp.loadedItems.map((item) => {
                    const p = products.find((prod) => prod.id === item.productId);
                    return (
                      <span
                        key={item.productId}
                        className="px-2 py-0.5 rounded bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px]"
                      >
                        {p?.name.split(' ')[0]}: <strong className="font-mono">{item.quantity}</strong> {p?.unit}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create Load Modal */}
      {showLoadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-800 my-auto max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
              Araca Sabah Yüklemesi Gir
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Şoförü seçin ve depodan yüklenen ürün miktarlarını girin
            </p>

            {errorMsg && (
              <div className="mb-3 p-2.5 rounded-lg bg-red-50 text-red-700 text-xs font-semibold">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleCreateLoad} className="space-y-4 text-xs">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Teslim Edilecek Şoför *
                </label>
                <select
                  required
                  value={selectedDriverId}
                  onChange={(e) => setSelectedDriverId(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Şoför Seçiniz...</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.isLeadDriver ? '★ (Yetkili Şoför)' : '(Saha Dağıtım)'}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Şoför seçimi araç plakasından bağımsızdır.
                </p>
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Araç Plakası (Dağıtım Aracı)
                </label>
                <select
                  value={selectedPlate}
                  onChange={(e) => setSelectedPlate(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono font-bold text-slate-900 dark:text-white"
                >
                  {AUTHORIZED_VEHICLE_PLATES.map((plate) => (
                    <option key={plate} value={plate}>
                      {plate}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  Günlük araç rotasyonuna göre geçerli dağıtım aracını seçiniz.
                </p>
              </div>

              {/* Products Quantities */}
              <div>
                <label className="font-bold text-slate-900 dark:text-white block mb-2">
                  Yüklenen Ürünler & Adetler
                </label>
                <div className="space-y-2 max-h-56 overflow-y-auto p-1">
                  {products.map((p) => {
                    const currentQty = loadQuantities[p.id] || 0;
                    return (
                      <div
                        key={p.id}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700"
                      >
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-white">{p.name}</div>
                          <div className="text-[10px] text-slate-400">{p.unit}</div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setLoadQuantities((prev) => ({
                                ...prev,
                                [p.id]: Math.max(0, currentQty - (p.category === 'damacana' ? 10 : 5)),
                              }))
                            }
                            className="w-8 h-8 rounded-lg bg-white dark:bg-slate-700 border text-xs font-bold"
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
                            className="w-16 h-8 rounded-lg border text-center font-mono font-bold text-xs bg-white dark:bg-slate-800"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setLoadQuantities((prev) => ({
                                ...prev,
                                [p.id]: currentQty + (p.category === 'damacana' ? 10 : 5),
                              }))
                            }
                            className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 text-xs font-bold"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowLoadModal(false)}
                  className="w-1/2 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-1/2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-md"
                >
                  {isSubmitting ? 'Kaydediliyor...' : 'Yüklemeyi Sisteme Gir'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

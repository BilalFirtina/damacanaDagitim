import React, { useState } from 'react';
import {
  Dispatch,
  Product,
  User,
  AUTHORIZED_VEHICLE_PLATES,
  filterProductsBySearch,
  groupProductsByCategory,
  isGlassDamacana,
  sortProductsForLoading,
} from '../../types';
import {
  Truck,
  Plus,
  ShieldCheck,
  Check,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
  Search,
  ChevronDown,
  Gem
} from 'lucide-react';
import { createDispatch, updateDispatch, cancelDispatch, updateUser } from '../../services/api';
import { todayUtcDateStr, formatDateTr } from '../../services/dateWindow';
import { isStaleDispatch } from '../../services/dispatchRules';

interface VehicleLoadManagementProps {
  dispatches: Dispatch[];
  users: User[];
  products: Product[];
  currentUser: User;
  onDispatchCreated: (dispatch: Dispatch) => void;
  onDispatchUpdated: (dispatch: Dispatch) => void;
  onDispatchCancelled: (dispatchId: string) => void;
  onUsersUpdated: (users: User[]) => void;
}

export const VehicleLoadManagement: React.FC<VehicleLoadManagementProps> = ({
  dispatches,
  users,
  products,
  currentUser,
  onDispatchCreated,
  onDispatchUpdated,
  onDispatchCancelled,
  onUsersUpdated,
}) => {
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');
  const [selectedPlate, setSelectedPlate] = useState<string>('');
  const [loadQuantities, setLoadQuantities] = useState<Record<string, number>>({});
  const [loadProductSearch, setLoadProductSearch] = useState('');
  const [editProductSearch, setEditProductSearch] = useState('');
  // Varsayılan olarak yalnızca Damacana Su açıktır; diğer kategoriler kapalıdır.
  const [openLoadCategories, setOpenLoadCategories] = useState<Record<string, boolean>>({
    damacana: true,
  });
  const [openEditCategories, setOpenEditCategories] = useState<Record<string, boolean>>({
    damacana: true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [editingDispatch, setEditingDispatch] = useState<Dispatch | null>(null);
  const [editQuantities, setEditQuantities] = useState<Record<string, number>>({});
  const [cancelTarget, setCancelTarget] = useState<Dispatch | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);

  const todayStr = todayUtcDateStr();

  // List of actual drivers
  const drivers = users.filter((u) => u.role === 'driver');

  // Aktif (henüz tamamlanmamış / bitiş raporu onaylanmamış) seferler
  const activeDispatches = dispatches.filter((d) => d.status !== 'completed');
  const busyDriverIds = new Set(activeDispatches.map((d) => d.driverId));
  const busyPlates = new Set(activeDispatches.map((d) => d.vehiclePlate));

  const openMatchingCategories = (
    search: string,
    setOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  ) => {
    if (!search.trim()) {
      setOpen({ damacana: true });
      return;
    }
    const matches = filterProductsBySearch(products, search);
    const codes = new Set(matches.map((p) => p.category || 'none'));
    setOpen(Object.fromEntries(Array.from(codes).map((code) => [code, true])));
  };

  const handleLoadProductSearchChange = (value: string) => {
    setLoadProductSearch(value);
    openMatchingCategories(value, setOpenLoadCategories);
  };

  const handleEditProductSearchChange = (value: string) => {
    setEditProductSearch(value);
    openMatchingCategories(value, setOpenEditCategories);
  };

  const handleOpenLoadModal = () => {
    const firstFreeDriver = drivers.find((d) => !busyDriverIds.has(d.id));
    if (firstFreeDriver) {
      setSelectedDriverId(firstFreeDriver.id);
    } else {
      setSelectedDriverId('');
    }
    const freePlates = AUTHORIZED_VEHICLE_PLATES.filter((plate) => !busyPlates.has(plate));
    setSelectedPlate(freePlates[0] || '');
    setErrorMsg(null);
    setLoadProductSearch('');
    setOpenLoadCategories({ damacana: true });
    setShowLoadModal(true);
  };

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

      const driver = users.find((u) => u.id === selectedDriverId);
      if (!driver) {
        setErrorMsg('Lütfen geçerli bir şoför seçiniz');
        return;
      }
      if (busyDriverIds.has(selectedDriverId)) {
        setErrorMsg('Seçilen şoför halen aktif bir dağıtım seferindedir');
        return;
      }
      if (!selectedPlate) {
        setErrorMsg('Lütfen bir araç plakası seçiniz');
        return;
      }
      if (busyPlates.has(selectedPlate)) {
        setErrorMsg('Seçilen araç halen aktif bir dağıtımda kullanılmaktadır');
        return;
      }

      const created = await createDispatch({
        driverId: driver.id,
        vehiclePlate: selectedPlate,
        loadedItems: items,
        loadedByUserId: currentUser.id,
        loadedByUserName: `${currentUser.name} (Depo Yöneticisi)`,
        driverConfirmed: false, // Standard driver must inspect & confirm
      });

      onDispatchCreated(created);
      setShowLoadModal(false);
      setSelectedDriverId('');
      setSelectedPlate('');
      setLoadQuantities({});
    } catch (err: any) {
      setErrorMsg(err.message || 'Yükleme oluşturulamadı');
    } finally {
      setIsSubmitting(false);
    }
  };

  const canCorrectDispatch = (disp: Dispatch) =>
    disp.status !== 'completed' &&
    !disp.hasActiveDeliveries &&
    !disp.hasLinkedPayments;

  const handleOpenEdit = (disp: Dispatch) => {
    setEditingDispatch(disp);
    setActionError(null);
    setEditProductSearch('');
    setOpenEditCategories({ damacana: true });
    setEditQuantities(
      Object.fromEntries(disp.loadedItems.map((item) => [item.productId, item.quantity]))
    );
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDispatch) return;
    const items = Object.entries(editQuantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([productId, quantity]) => ({ productId, quantity }));
    if (items.length === 0) {
      setActionError('En az bir ürün için sıfırdan büyük adet girmelisiniz.');
      return;
    }
    try {
      setIsActionSubmitting(true);
      setActionError(null);
      const updated = await updateDispatch(editingDispatch.id, { loadedItems: items });
      onDispatchUpdated(updated);
      setEditingDispatch(null);
    } catch (err: any) {
      setActionError(err.message || 'Yükleme düzenlenemedi');
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handleOpenCancel = (disp: Dispatch) => {
    setCancelTarget(disp);
    setCancelReason('');
    setActionError(null);
  };

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
    if (reason.length < 3) {
      setActionError('İptal için en az 3 karakterlik bir gerekçe girin.');
      return;
    }
    try {
      setIsActionSubmitting(true);
      setActionError(null);
      await cancelDispatch(cancelTarget.id, reason);
      onDispatchCancelled(cancelTarget.id);
      setCancelTarget(null);
      setCancelReason('');
    } catch (err: any) {
      setActionError(err.message || 'Yükleme iptal edilemedi');
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const filteredLoadProducts = filterProductsBySearch(products, loadProductSearch);
  const groupedLoadProducts = groupProductsByCategory(
    filteredLoadProducts,
    sortProductsForLoading
  );
  const filteredEditProducts = filterProductsBySearch(products, editProductSearch);
  const groupedEditProducts = groupProductsByCategory(
    filteredEditProducts,
    sortProductsForLoading
  );

  const toggleLoadCategory = (code: string) => {
    setOpenLoadCategories((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  const toggleEditCategory = (code: string) => {
    setOpenEditCategories((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  return (
    <div className="space-y-6 w-full max-w-full min-w-0">
      {/* Header */}
      <div className="bg-white  rounded-2xl border border-slate-200  p-4 sm:p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4 w-full max-w-full">
        <div>
          <h2 className="text-base font-bold text-slate-900  flex items-center gap-2">
            <Truck className="w-5 h-5 text-indigo-600" />
            <span>Depo Araç Yükleme Yönetimi & Şoför Yetkilendirme</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Sadece yöneticinin veya yetki verdiği şoförlerin yükleme girebilmesi kuralı buradan yönetilir
          </p>
        </div>

        <button
          onClick={handleOpenLoadModal}
          className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-all whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>Depo Yükleme Girişi</span>
        </button>
      </div>

      {/* Driver Loading Permission Management Card */}
      <div className="bg-white  rounded-2xl border border-slate-200  p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 ">
          <div>
            <h3 className="text-xs font-bold text-slate-900  uppercase tracking-wider">
              Şoför Depo Yükleme Yetkileri (canLoadVehicle)
            </h3>
            <p className="text-[11px] text-slate-500">
              Yetkisi olmayan şoförler sabah sadece yüklenen adetleri kontrol edip teslim alma onayı verebilir.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {drivers.map((driver) => {
            const isBusy = busyDriverIds.has(driver.id);
            const activeRun = activeDispatches.find((d) => d.driverId === driver.id);
            const completedRuns = dispatches.filter(
              (d) => d.date === todayStr && d.driverId === driver.id && d.status === 'completed'
            );

            return (
              <div
                key={driver.id}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-2 w-full min-w-0">
                  <h3 className="text-xs font-bold text-slate-900 break-words min-w-0 leading-snug">
                    {driver.name}
                  </h3>

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

                <div className="flex flex-col items-start gap-1.5 min-w-0">
                  {isBusy ? (
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        activeRun && isStaleDispatch(activeRun, todayStr)
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {activeRun && isStaleDispatch(activeRun, todayStr)
                        ? `Önceki gün sonlandırılmadı (${activeRun.vehiclePlate})`
                        : `Dağıtımda (${activeRun?.vehiclePlate})`}
                    </span>
                  ) : completedRuns.length > 0 ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      Müsait (#{completedRuns.length + 1}. Sefer İçin Hazır)
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      Müsait (Yüklemeye Hazır)
                    </span>
                  )}

                  <div className="text-[11px] text-slate-400 font-mono">
                    {driver.phone || 'Telefon yok'}
                  </div>

                  <div className="text-[11px] font-semibold">
                    {driver.canLoadVehicle ? (
                      <span className="text-emerald-600 flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 shrink-0" /> Yükleme Yetkisi Var
                      </span>
                    ) : (
                      <span className="text-slate-400">Yükleme Yetkisi Yok (Onaycı)</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Today's Dispatches / Vehicle Loads Table */}
      <div className="bg-white  rounded-2xl border border-slate-200  p-5 shadow-xs space-y-3">
        <h3 className="text-xs font-bold text-slate-900  uppercase tracking-wider">
          Sefer ve Araç Yüklemeleri ({dispatches.length} Sefer)
        </h3>

        <div className="divide-y divide-slate-100  text-xs">
          {dispatches.map((disp) => (
            <div key={disp.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold px-2 py-0.5 rounded bg-slate-100  text-slate-900 ">
                    {disp.vehiclePlate}
                  </span>
                  <span className="font-bold text-slate-800 ">{disp.driverName}</span>
                  {isStaleDispatch(disp, todayStr) && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800  ">
                      Önceki gün sonlandırılmadı
                    </span>
                  )}
                  {disp.status === 'in_transit' ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      Şoför Onayladı (Sahada / Dağıtımda)
                    </span>
                  ) : disp.status === 'pending_confirmation' ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                      Şoför Sayım Onayı Bekliyor (Dağıtımda)
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800">
                      Bitiş Raporu Tamamlandı (Kapatıldı / Müsait)
                    </span>
                  )}
                </div>

                <div className="text-[11px] text-slate-500">
                  Tarih: <strong>{formatDateTr(disp.date)}</strong> · Yükleyen: <strong>{disp.loadedByUserName}</strong>
                  {disp.driverConfirmedAt && ` · Onay Zamanı: ${new Date(disp.driverConfirmedAt).toLocaleTimeString('tr-TR')}`}
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {disp.loadedItems.map((item) => {
                    const p = products.find((prod) => prod.id === item.productId);
                    return (
                      <span
                        key={item.productId}
                        className="px-2 py-0.5 rounded bg-slate-50  border border-slate-200  text-[11px]"
                      >
                        {p?.name.split(' ')[0]}: <strong className="font-mono">{item.quantity}</strong> {p?.unit}
                      </span>
                    );
                  })}
                </div>
              </div>

              {disp.status !== 'completed' && (
                <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-center">
                  {canCorrectDispatch(disp) ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(disp)}
                        className="min-h-11 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold text-xs flex items-center gap-1.5"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Düzenle</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenCancel(disp)}
                        className="min-h-11 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 font-semibold text-xs flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>İptal</span>
                      </button>
                    </>
                  ) : (
                    <span className="text-[10px] font-semibold text-slate-400">
                      Teslimat veya tahsilat başladı; yükleme düzeltilemez.
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Create Load Modal */}
      {showLoadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white  p-6 shadow-2xl border border-slate-200  my-auto max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-slate-900  mb-1">
              Depo Yükleme Girişi
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Müsait şoförü ve aracı seçin, depodan yüklenen ürün miktarlarını girin
            </p>

            {errorMsg && (
              <div className="mb-3 p-2.5 rounded-lg bg-red-50 text-red-700 text-xs font-semibold">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleCreateLoad} className="space-y-4 text-xs">
              <div className="w-full max-w-full min-w-0 box-border">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-slate-700 ">
                    Teslim Edilecek Şoför *
                  </label>
                  <span className="text-[11px] text-slate-400">
                    {selectedDriverId ? '1 şoför seçildi' : 'Seçim yapınız'}
                  </span>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto p-0.5 w-full max-w-full min-w-0 box-border">
                  {drivers.map((d) => {
                    const isBusy = busyDriverIds.has(d.id);
                    const isAuthorized = d.isLeadDriver || d.canLoadVehicle;
                    const isSelected = selectedDriverId === d.id;

                    if (isBusy) {
                      return (
                        <button
                          key={d.id}
                          type="button"
                          disabled
                          className="w-full max-w-full min-w-0 flex items-center justify-between p-2.5 rounded-xl border border-slate-200  bg-slate-100/70  text-slate-400  cursor-not-allowed text-xs font-semibold text-left select-none"
                        >
                          <div className="flex items-center gap-2 truncate min-w-0">
                            <span className="w-2 h-2 rounded-full bg-slate-300  shrink-0" />
                            <span className="truncate">{d.name}{isAuthorized ? ' (Yetkili)' : ''}</span>
                          </div>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200/80  text-slate-500  shrink-0 ml-2">
                            Dağıtımda
                          </span>
                        </button>
                      );
                    }

                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setSelectedDriverId(d.id)}
                        className={`w-full max-w-full min-w-0 flex items-center justify-between p-2.5 rounded-xl border text-xs font-semibold text-left transition-all ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-50/90 text-indigo-950    shadow-xs ring-1 ring-indigo-600 '
                            : 'border-slate-200  bg-white  text-slate-800  hover:border-slate-300  hover:bg-slate-50 '
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate min-w-0">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? 'bg-indigo-600  ring-2 ring-indigo-200 ' : 'bg-emerald-500'}`} />
                          <span className="truncate">{d.name}{isAuthorized ? ' (Yetkili)' : ''}</span>
                        </div>
                        {isSelected && (
                          <Check className="w-4 h-4 text-indigo-600  shrink-0 ml-2" />
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Aktif seferde olan şoförler önceki sefer bitiş raporunu kapatmadan yeni sefere seçilemez.
                </p>
              </div>

              <div className="w-full max-w-full min-w-0 box-border">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-slate-700 ">
                    Araç Plakası (Dağıtım Aracı) *
                  </label>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {selectedPlate || 'Seçim yapınız'}
                  </span>
                </div>
                <div className="space-y-1.5 max-h-44 overflow-y-auto p-0.5 w-full max-w-full min-w-0 box-border">
                  {AUTHORIZED_VEHICLE_PLATES.map((plate) => {
                    const isBusy = busyPlates.has(plate);
                    const isSelected = selectedPlate === plate;

                    if (isBusy) {
                      return (
                        <button
                          key={plate}
                          type="button"
                          disabled
                          className="w-full max-w-full min-w-0 flex items-center justify-between p-2.5 rounded-xl border border-slate-200  bg-slate-100/70  text-slate-400  cursor-not-allowed text-xs font-mono font-bold text-left select-none"
                        >
                          <div className="flex items-center gap-2 truncate min-w-0">
                            <span className="w-2 h-2 rounded-full bg-slate-300  shrink-0" />
                            <span className="truncate">{plate}</span>
                          </div>
                          <span className="text-[10px] font-sans font-bold px-1.5 py-0.5 rounded bg-slate-200/80  text-slate-500  shrink-0 ml-2">
                            Dağıtımda
                          </span>
                        </button>
                      );
                    }

                    return (
                      <button
                        key={plate}
                        type="button"
                        onClick={() => setSelectedPlate(plate)}
                        className={`w-full max-w-full min-w-0 flex items-center justify-between p-2.5 rounded-xl border font-mono font-bold text-xs text-left transition-all ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-50/90 text-indigo-950    shadow-xs ring-1 ring-indigo-600 '
                            : 'border-slate-200  bg-white  text-slate-800  hover:border-slate-300  hover:bg-slate-50 '
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate min-w-0">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? 'bg-indigo-600  ring-2 ring-indigo-200 ' : 'bg-emerald-500'}`} />
                          <span className="truncate">{plate}</span>
                        </div>
                        {isSelected && (
                          <Check className="w-4 h-4 text-indigo-600  shrink-0 ml-2" />
                        )}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Aktif dağıtımda olan araçlar seçilemez; yalnızca müsait araçlar seçilebilir.
                </p>
              </div>

              {/* Products Quantities */}
              <div>
                <label className="font-bold text-slate-900  block mb-2">
                  Yüklenen Ürünler & Adetler
                </label>
                <div className="relative mb-2">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={loadProductSearch}
                    onChange={(e) => handleLoadProductSearchChange(e.target.value)}
                    placeholder="Ürün adı ile ara..."
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                  />
                </div>
                <div className="space-y-2 max-h-56 overflow-y-auto p-1">
                  {groupedLoadProducts.map((group) => {
                    const isOpen = Boolean(openLoadCategories[group.code]);
                    const selectedCount = group.products.filter(
                      (p) => (loadQuantities[p.id] || 0) > 0
                    ).length;

                    return (
                      <section
                        key={group.code}
                        className="rounded-xl border border-slate-200 bg-white overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => toggleLoadCategory(group.code)}
                          aria-expanded={isOpen}
                          aria-controls={`admin-load-cat-${group.code}`}
                          className={`w-full min-h-11 px-3 py-2.5 flex items-center justify-between gap-2 text-left transition-colors ${
                            isOpen ? 'bg-slate-50' : 'bg-white hover:bg-slate-50'
                          }`}
                        >
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                            {group.title}
                          </span>
                          <span className="flex items-center gap-2 shrink-0">
                            {!isOpen && selectedCount > 0 && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                                {selectedCount} kalem
                              </span>
                            )}
                            <ChevronDown
                              className={`w-4 h-4 text-slate-400 transition-transform ${
                                isOpen ? 'rotate-180' : ''
                              }`}
                            />
                          </span>
                        </button>

                        {isOpen && (
                          <div
                            id={`admin-load-cat-${group.code}`}
                            role="region"
                            aria-label={group.title}
                            className="p-2 pt-0 space-y-2"
                          >
                            {group.products.map((p) => {
                              const currentQty = loadQuantities[p.id] || 0;
                              const step = p.category === 'damacana' ? 10 : 5;
                              const isGlass = isGlassDamacana(p);
                              return (
                                <div
                                  key={p.id}
                                  className={`flex flex-col gap-2 p-2.5 rounded-xl border sm:flex-row sm:items-center sm:justify-between ${
                                    isGlass
                                      ? 'border-cyan-200 bg-gradient-to-br from-cyan-50 via-sky-50 to-white ring-1 ring-cyan-100 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9)]'
                                      : 'bg-slate-50 border-slate-100'
                                  }`}
                                >
                                  <div className="min-w-0 pr-2">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <div className="font-semibold text-slate-900  break-words">
                                        {p.name}
                                      </div>
                                      {isGlass && (
                                        <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-white/80 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-cyan-700">
                                          <Gem className="w-2.5 h-2.5" />
                                          Cam
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-slate-400">{p.unit}</div>
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setLoadQuantities((prev) => ({
                                          ...prev,
                                          [p.id]: Math.max(0, currentQty - step),
                                        }))
                                      }
                                      className="w-11 h-11 rounded-lg bg-white  border text-sm font-bold"
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
                                      className="w-16 h-11 min-h-11 rounded-lg border text-center font-mono font-bold text-sm bg-white text-slate-900"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setLoadQuantities((prev) => ({
                                          ...prev,
                                          [p.id]: currentQty + step,
                                        }))
                                      }
                                      className="w-11 h-11 rounded-lg bg-indigo-50 text-indigo-600 text-sm font-bold"
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
                  {filteredLoadProducts.length === 0 && (
                    <div className="p-4 text-center text-xs text-slate-400">
                      Ürün bulunamadı.
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowLoadModal(false)}
                  className="w-1/2 py-2.5 rounded-xl border border-slate-200  font-semibold"
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

      {/* Edit Load Modal — yalnızca yönetici */}
      {editingDispatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 my-auto max-h-[90vh] overflow-y-auto p-5 sm:p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Yüklemeyi Düzenle</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {editingDispatch.driverName} · {editingDispatch.vehiclePlate}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingDispatch(null)}
                className="w-10 h-10 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center shrink-0"
                aria-label="Kapat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {actionError && (
              <div className="mb-3 p-2.5 rounded-lg bg-red-50 text-red-700 text-xs font-semibold">
                {actionError}
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-slate-900 block mb-2">
                  Yüklenen Ürünler & Adetler
                </label>
                <div className="relative mb-2">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={editProductSearch}
                    onChange={(e) => handleEditProductSearchChange(e.target.value)}
                    placeholder="Ürün adı ile ara..."
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium"
                  />
                </div>
                <div className="space-y-2 max-h-72 overflow-y-auto p-1">
                  {groupedEditProducts.map((group) => {
                    const isOpen = Boolean(openEditCategories[group.code]);
                    const selectedCount = group.products.filter(
                      (p) => (editQuantities[p.id] || 0) > 0
                    ).length;

                    return (
                      <section
                        key={group.code}
                        className="rounded-xl border border-slate-200 bg-white overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => toggleEditCategory(group.code)}
                          aria-expanded={isOpen}
                          aria-controls={`admin-edit-cat-${group.code}`}
                          className={`w-full min-h-11 px-3 py-2.5 flex items-center justify-between gap-2 text-left transition-colors ${
                            isOpen ? 'bg-slate-50' : 'bg-white hover:bg-slate-50'
                          }`}
                        >
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                            {group.title}
                          </span>
                          <span className="flex items-center gap-2 shrink-0">
                            {!isOpen && selectedCount > 0 && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                                {selectedCount} kalem
                              </span>
                            )}
                            <ChevronDown
                              className={`w-4 h-4 text-slate-400 transition-transform ${
                                isOpen ? 'rotate-180' : ''
                              }`}
                            />
                          </span>
                        </button>

                        {isOpen && (
                          <div
                            id={`admin-edit-cat-${group.code}`}
                            role="region"
                            aria-label={group.title}
                            className="p-2 pt-0 space-y-2"
                          >
                            {group.products.map((p) => {
                              const currentQty = editQuantities[p.id] || 0;
                              const step = p.category === 'damacana' ? 10 : 5;
                              const isGlass = isGlassDamacana(p);
                              return (
                                <div
                                  key={p.id}
                                  className={`flex flex-col gap-2 p-2.5 rounded-xl border sm:flex-row sm:items-center sm:justify-between ${
                                    isGlass
                                      ? 'border-cyan-200 bg-gradient-to-br from-cyan-50 via-sky-50 to-white ring-1 ring-cyan-100 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9)]'
                                      : 'bg-slate-50 border-slate-100'
                                  }`}
                                >
                                  <div className="min-w-0 pr-2">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <div className="font-semibold text-slate-900 break-words">
                                        {p.name}
                                      </div>
                                      {isGlass && (
                                        <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-white/80 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-cyan-700">
                                          <Gem className="w-2.5 h-2.5" />
                                          Cam
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-slate-400">{p.unit}</div>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setEditQuantities((prev) => ({
                                          ...prev,
                                          [p.id]: Math.max(0, currentQty - step),
                                        }))
                                      }
                                      className="w-11 h-11 rounded-lg bg-white border text-sm font-bold"
                                    >
                                      -
                                    </button>
                                    <input
                                      type="number"
                                      value={currentQty === 0 ? '' : currentQty}
                                      onChange={(e) =>
                                        setEditQuantities((prev) => ({
                                          ...prev,
                                          [p.id]: Math.max(0, parseInt(e.target.value) || 0),
                                        }))
                                      }
                                      placeholder="0"
                                      className="w-16 h-11 min-h-11 rounded-lg border text-center font-mono font-bold text-sm bg-white text-slate-900"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setEditQuantities((prev) => ({
                                          ...prev,
                                          [p.id]: currentQty + step,
                                        }))
                                      }
                                      className="w-11 h-11 rounded-lg bg-indigo-50 text-indigo-600 text-sm font-bold"
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
                  })}
                  {filteredEditProducts.length === 0 && (
                    <div className="p-4 text-center text-xs text-slate-400">
                      Ürün bulunamadı.
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setEditingDispatch(null)}
                  className="w-1/2 min-h-11 py-2.5 rounded-xl border border-slate-200 font-semibold"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={isActionSubmitting}
                  className="w-1/2 min-h-11 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold shadow-md"
                >
                  {isActionSubmitting ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Load Modal — yalnızca yönetici */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 my-auto p-5 sm:p-6 shadow-2xl">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-slate-900">Yüklemeyi İptal Et</h3>
                <p className="text-xs text-slate-500 mt-0.5 break-words">
                  {cancelTarget.driverName} · {cancelTarget.vehiclePlate} yüklemesi fiziksel olarak
                  silinecek. İşlem denetim kaydına alınacak.
                </p>
              </div>
            </div>

            {actionError && (
              <div className="mb-3 p-2.5 rounded-lg bg-red-50 text-red-700 text-xs font-semibold">
                {actionError}
              </div>
            )}

            <form onSubmit={handleConfirmCancel} className="space-y-3 text-xs">
              <label className="font-semibold text-slate-700 block">
                İptal Gerekçesi *
              </label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Yanlış yükleme girildi..."
                className="w-full p-2.5 rounded-xl border border-slate-200 bg-white text-xs"
                required
              />
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setCancelTarget(null)}
                  className="w-1/2 min-h-11 py-2.5 rounded-xl border border-slate-200 font-semibold"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={isActionSubmitting || cancelReason.trim().length < 3}
                  className="w-1/2 min-h-11 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-semibold"
                >
                  {isActionSubmitting ? 'İptal ediliyor...' : 'Yüklemeyi İptal Et'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

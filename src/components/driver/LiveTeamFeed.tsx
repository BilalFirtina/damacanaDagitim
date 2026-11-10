import React, { useState, useMemo } from 'react';
import { Customer, Delivery, Product, User } from '../../types';
import { isAccountCustomerDelivery } from '../../services/customerVisibility';
import {
  Clock,
  Truck,
  RotateCcw,
  Wallet,
  CreditCard,
  Building2,
  Search,
  Filter,
  Users
} from 'lucide-react';

interface LiveTeamFeedProps {
  deliveries: Delivery[];
  currentUser: User;
  customers?: Customer[];
  products?: Product[];
}

// Ayırt edici şoför renk paletleri (Her şoför alt alta listelendiğinde belirgin şekilde ayrışır)
export interface DriverPalette {
  name: string;
  id: string;
  borderClass: string;
  bgCardClass: string;
  badgeClass: string;
  iconBgClass: string;
  dotClass: string;
  textClass: string;
}

export const DRIVER_PALETTES: DriverPalette[] = [
  {
    name: 'Mavi',
    id: 'blue',
    borderClass: 'border-l-4 border-l-blue-500 border-blue-200 ',
    bgCardClass: 'bg-blue-50/20 ',
    badgeClass: 'bg-blue-100 text-blue-900   border border-blue-300 ',
    iconBgClass: 'bg-blue-600 text-white',
    dotClass: 'bg-blue-500',
    textClass: 'text-blue-700 ',
  },
  {
    name: 'Kırmızı',
    id: 'rose',
    borderClass: 'border-l-4 border-l-rose-500 border-rose-200 ',
    bgCardClass: 'bg-rose-50/20 ',
    badgeClass: 'bg-rose-100 text-rose-900   border border-rose-300 ',
    iconBgClass: 'bg-rose-600 text-white',
    dotClass: 'bg-rose-500',
    textClass: 'text-rose-700 ',
  },
  {
    name: 'Yeşil',
    id: 'emerald',
    borderClass: 'border-l-4 border-l-emerald-500 border-emerald-200 ',
    bgCardClass: 'bg-emerald-50/20 ',
    badgeClass: 'bg-emerald-100 text-emerald-900   border border-emerald-300 ',
    iconBgClass: 'bg-emerald-600 text-white',
    dotClass: 'bg-emerald-500',
    textClass: 'text-emerald-700 ',
  },
  {
    name: 'Mor',
    id: 'purple',
    borderClass: 'border-l-4 border-l-purple-500 border-purple-200 ',
    bgCardClass: 'bg-purple-50/20 ',
    badgeClass: 'bg-purple-100 text-purple-900   border border-purple-300 ',
    iconBgClass: 'bg-purple-600 text-white',
    dotClass: 'bg-purple-500',
    textClass: 'text-purple-700 ',
  },
  {
    name: 'Turuncu',
    id: 'amber',
    borderClass: 'border-l-4 border-l-amber-500 border-amber-200 ',
    bgCardClass: 'bg-amber-50/20 ',
    badgeClass: 'bg-amber-100 text-amber-900   border border-amber-300 ',
    iconBgClass: 'bg-amber-600 text-white',
    dotClass: 'bg-amber-500',
    textClass: 'text-amber-700 ',
  },
  {
    name: 'Camgöbeği (Teal)',
    id: 'cyan',
    borderClass: 'border-l-4 border-l-cyan-500 border-cyan-200 ',
    bgCardClass: 'bg-cyan-50/20 ',
    badgeClass: 'bg-cyan-100 text-cyan-900   border border-cyan-300 ',
    iconBgClass: 'bg-cyan-600 text-white',
    dotClass: 'bg-cyan-500',
    textClass: 'text-cyan-700 ',
  },
];

// Şoför kimliğine göre kararlı ve benzersiz renk atama fonksiyonu
export const getDriverPalette = (driverId: string, driverName?: string): DriverPalette => {
  const key = driverId || driverName || 'default';
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % DRIVER_PALETTES.length;
  return DRIVER_PALETTES[index];
};

export const LiveTeamFeed: React.FC<LiveTeamFeedProps> = ({
  deliveries,
  currentUser,
  customers = [],
  products = [],
}) => {
  const [filterPlate, setFilterPlate] = useState<string>('all');
  const [filterDriverId, setFilterDriverId] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Extract unique vehicle plates for filtering
  const plates = useMemo(() => {
    return Array.from(new Set(deliveries.map((d) => d.vehiclePlate).filter(Boolean)));
  }, [deliveries]);

  // Extract unique drivers present in the delivery feed with stats
  const activeDrivers = useMemo(() => {
    const driverMap = new Map<string, { id: string; name: string; plate: string; count: number }>();
    deliveries.forEach((d) => {
      const existing = driverMap.get(d.driverId);
      if (existing) {
        existing.count += 1;
        if (d.vehiclePlate) existing.plate = d.vehiclePlate;
      } else {
        driverMap.set(d.driverId, {
          id: d.driverId,
          name: d.driverName,
          plate: d.vehiclePlate,
          count: 1,
        });
      }
    });
    return Array.from(driverMap.values());
  }, [deliveries]);

  const filtered = deliveries.filter((d) => {
    const matchesPlate = filterPlate === 'all' || d.vehiclePlate === filterPlate;
    const matchesDriver = filterDriverId === 'all' || d.driverId === filterDriverId;
    const matchesSearch =
      d.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.driverName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.customerAddress.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.vehiclePlate.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesPlate && matchesDriver && matchesSearch;
  });

  return (
    <div className="space-y-4 w-full max-w-full min-w-0">
      {/* Top Banner & Control Bar */}
      <div className="bg-white  rounded-2xl border border-slate-200  p-4 sm:p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 ">
              Ortak Saha & Ekip Canlı Teslimat Akışı
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Tüm araçların ve şoförlerin teslimatları anlık olarak bu ekrana düşer. Her şoförün teslimatı kendi özel rengiyle ayırt edilir.
          </p>
        </div>

        {/* Filter and search controls */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-52">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Müşteri, şoför veya plaka..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200  bg-slate-50  text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div className="relative shrink-0">
            <select
              value={filterPlate}
              onChange={(e) => setFilterPlate(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 rounded-xl border border-slate-200  bg-white  text-xs font-semibold text-slate-700  focus:outline-none"
            >
              <option value="all">Tüm Plakalar ({plates.length})</option>
              {plates.map((plate) => (
                <option key={plate} value={plate}>
                  {plate}
                </option>
              ))}
            </select>
            <Filter className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Driver Color Legend (Şoför Renk Kodları Lejantı) */}
      {activeDrivers.length > 0 && (
        <div className="bg-white  rounded-2xl border border-slate-200  p-3 sm:p-4 shadow-xs">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100  text-xs text-slate-500">
            <div className="flex items-center gap-1.5 font-bold text-slate-700 ">
              <Users className="w-3.5 h-3.5 text-sky-600" />
              <span>Aktif Şoför Renk Kodları (Filtrelemek için tıklayabilirsiniz):</span>
            </div>
            {filterDriverId !== 'all' && (
              <button
                onClick={() => setFilterDriverId('all')}
                className="text-[11px] text-sky-600 hover:underline font-semibold"
              >
                Filtreyi Temizle
              </button>
            )}
          </div>

          <div className="flex w-full min-w-0 flex-col gap-2 min-[426px]:flex-row min-[426px]:flex-wrap min-[426px]:items-stretch">
            <button
              onClick={() => setFilterDriverId('all')}
              className={`flex w-full min-w-0 items-center justify-center whitespace-nowrap px-2.5 py-1 rounded-xl text-xs font-semibold transition-all min-[426px]:w-auto min-[426px]:flex-auto sm:min-h-11 sm:py-2 ${
                filterDriverId === 'all'
                  ? 'bg-slate-800 text-white   shadow-xs'
                  : 'bg-slate-100  text-slate-600  hover:bg-slate-200'
              }`}
            >
              Tüm Şoförler ({deliveries.length})
            </button>

            {activeDrivers.map((driver) => {
              const pal = getDriverPalette(driver.id, driver.name);
              const isSelected = filterDriverId === driver.id;

              return (
                <button
                  key={driver.id}
                  onClick={() => setFilterDriverId(isSelected ? 'all' : driver.id)}
                  className={`flex w-full min-w-0 items-center justify-center gap-1.5 whitespace-nowrap px-3 py-1 rounded-xl text-xs font-bold transition-all border min-[426px]:w-auto min-[426px]:flex-auto sm:min-h-11 sm:py-2 ${
                    pal.badgeClass
                  } ${
                    isSelected
                      ? 'ring-2 ring-offset-1 ring-sky-500 shadow-xs scale-102'
                      : 'hover:opacity-90'
                  }`}
                  title={`${driver.name} - ${pal.name} renk kodu (${driver.count} teslimat)`}
                >
                  <span className={`w-2 h-2 rounded-full ${pal.dotClass}`} />
                  <span>{driver.name}</span>
                  {driver.plate && (
                    <span className="font-mono text-[10px] opacity-80">({driver.plate})</span>
                  )}
                  <span className="ml-1 px-1.5 py-0.2 rounded-full bg-white/70  text-[10px] font-mono">
                    {driver.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Feed List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="p-12 text-center bg-white  rounded-2xl border border-slate-200  text-slate-400 text-xs">
            Henüz bu kritere uyan bir teslimat kaydı bulunmuyor.
          </div>
        ) : (
          filtered.map((item) => {
            const timeStr = new Date(item.timestamp).toLocaleTimeString('tr-TR', {
              hour: '2-digit',
              minute: '2-digit',
            });
            const isMe = item.driverId === currentUser.id;
            const pal = getDriverPalette(item.driverId, item.driverName);
            const isAccount = isAccountCustomerDelivery(item, customers);

            return (
              <div
                key={item.id}
                className={`bg-white  rounded-2xl border p-4 sm:p-5 shadow-xs transition-all hover:shadow-md ${pal.borderClass} ${pal.bgCardClass}`}
              >
                {/* Row 1: Header with vehicle, driver, customer & timestamp */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 ">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 shadow-xs ${pal.iconBgClass}`}
                    >
                      <Truck className="w-4 h-4" />
                    </div>

                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Driver Name Badge with Specific Color */}
                        <span
                          className={`font-bold text-xs px-2.5 py-0.5 rounded-lg flex items-center gap-1.5 ${pal.badgeClass}`}
                        >
                          <span className={`w-2 h-2 rounded-full ${pal.dotClass}`} />
                          <span>{item.driverName}</span>
                          {isMe && <span className="text-[10px] font-normal">(Siz)</span>}
                        </span>

                        {/* Vehicle Plate Badge */}
                        <span className="font-mono font-bold text-xs px-2 py-0.5 rounded-lg bg-slate-100  text-slate-800  border border-slate-200 ">
                          {item.vehiclePlate}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Clock className="w-3.5 h-3.5" />
                    <span className="font-mono">{timeStr}</span>
                    {item.isOfflineSync && (
                      <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                        Çevrimdışı eşitlendi
                      </span>
                    )}
                  </div>
                </div>

                {/* Row 2: Customer & Delivery Details */}
                <div className="mt-3 flex flex-col md:flex-row md:items-start justify-between gap-4">
                  {/* Left: Customer & Delivered Items */}
                  <div className="space-y-2 flex-1">
                    <div className="flex items-baseline gap-1.5 flex-wrap min-w-0">
                      <Building2 className={`w-4 h-4 shrink-0 translate-y-0.5 ${pal.textClass}`} />
                      <span className="text-sm font-bold text-slate-900  break-words">
                        {item.customerName}
                      </span>
                      {item.customerAddress && (
                        <span className="text-xs text-slate-400 break-words">· {item.customerAddress}</span>
                      )}
                    </div>

                    {/* Delivered Products Badges */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {item.deliveredItems.map((prod, idx) => {
                        const unit = products.find((p) => p.id === prod.productId)?.unit;
                        return (
                          <span
                            key={idx}
                            className="px-2.5 py-1 rounded-lg bg-white/90  text-slate-800  text-xs font-medium border border-slate-200  shadow-2xs max-w-full break-words"
                          >
                            {prod.productName} -{' '}
                            <strong className={`font-mono tabular-nums ${pal.textClass}`}>
                              {prod.quantity}
                            </strong>
                            {unit ? ` ${unit}` : ''}{' '}
                            {!isAccount && (
                              <span className="text-slate-400 font-normal">
                                ({prod.unitPrice} ₺)
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </div>

                    {/* Deposit empty containers */}
                    {(item.emptyContainersReceived?.damacana > 0 ||
                      (item.emptyContainersReceived?.camDamacana || 0) > 0 ||
                      (item.emptyContainersReceived?.tupBuyuk || 0) > 0 ||
                      (item.emptyContainersReceived?.tupKucuk || 0) > 0 ||
                      item.emptyContainersReceived?.tup > 0) && (
                      <div className="flex items-center gap-1 text-[11px] font-medium text-orange-600 ">
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Alınan Boş Kap:</span>
                        {item.emptyContainersReceived.damacana > 0 && (
                          <strong className="font-mono">
                            {item.emptyContainersReceived.damacana} Boş Damacana
                          </strong>
                        )}
                        {(item.emptyContainersReceived.camDamacana || 0) > 0 && (
                          <strong className="font-mono">
                            , {item.emptyContainersReceived.camDamacana} Boş Cam Damacana
                          </strong>
                        )}
                        {(item.emptyContainersReceived.tupBuyuk || 0) > 0 && (
                          <strong className="font-mono">
                            , {item.emptyContainersReceived.tupBuyuk} Büyük Boş Tüp
                          </strong>
                        )}
                        {(item.emptyContainersReceived.tupKucuk || 0) > 0 && (
                          <strong className="font-mono">
                            , {item.emptyContainersReceived.tupKucuk} Küçük Boş Tüp
                          </strong>
                        )}
                        {item.emptyContainersReceived.tup > 0 && (
                          <strong className="font-mono">
                            , {item.emptyContainersReceived.tup} Boş Tüp (eski)
                          </strong>
                        )}
                      </div>
                    )}

                    {item.notes && (
                      <div className="text-[11px] text-slate-500 italic">
                        Not: "{item.notes}"
                      </div>
                    )}
                  </div>

                  {/* Right: Payment Breakdown Card */}
                  <div className="bg-white/80  p-3 rounded-xl border border-slate-200  shrink-0 min-w-[200px] text-right space-y-1 shadow-2xs">
                    <div className="text-[11px] text-slate-500">
                      {isAccount ? 'Faturalı Müşteri' : 'Mal Bedeli / Tutar'}
                    </div>
                    {!isAccount && (
                      <div className="text-base font-extrabold font-mono text-slate-900  tabular-nums">
                        {item.deliveredGrandTotal.toLocaleString('tr-TR')} ₺
                      </div>
                    )}

                    {/* Payment badges */}
                    <div className="flex items-center justify-end gap-1.5 pt-1">
                      {item.collectedPayment.cashAmount > 0 && (
                        <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded bg-emerald-100 text-emerald-800">
                          <Wallet className="w-3.5 h-3.5" />
                          {item.collectedPayment.cashAmount.toLocaleString('tr-TR')} ₺ Nakit
                        </span>
                      )}

                      {item.collectedPayment.posAmount > 0 && (
                        <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded bg-indigo-100 text-indigo-800">
                          <CreditCard className="w-3.5 h-3.5" />
                          {item.collectedPayment.posAmount.toLocaleString('tr-TR')} ₺ POS
                        </span>
                      )}

                      {item.collectedPayment.totalCollected === 0 && (
                        <span className="text-xs font-bold px-2.5 py-1 rounded bg-amber-100 text-amber-800">
                          {isAccount ? 'Tahsilat Yapılmadı' : 'Tahsilat Alınmadı (0 ₺)'}
                        </span>
                      )}
                    </div>

                    {!isAccount && item.collectedPayment.diffUncollected > 0 && (
                      <div className="text-[10px] text-amber-700  font-medium pt-0.5">
                        +{item.collectedPayment.diffUncollected.toLocaleString('tr-TR')} ₺ Cariye Borç Yazıldı
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

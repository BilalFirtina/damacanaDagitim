import React, { useState } from 'react';
import { Delivery, User } from '../../types';
import {
  Clock,
  Truck,
  RotateCcw,
  Wallet,
  CreditCard,
  Building2,
  Search,
  Filter,
  CheckCircle2,
  Calendar
} from 'lucide-react';

interface LiveTeamFeedProps {
  deliveries: Delivery[];
  currentUser: User;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

export const LiveTeamFeed: React.FC<LiveTeamFeedProps> = ({
  deliveries,
  currentUser,
  onRefresh,
  isRefreshing,
}) => {
  const [filterPlate, setFilterPlate] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Extract unique vehicle plates for filtering
  const plates = Array.from(new Set(deliveries.map((d) => d.vehiclePlate)));

  const filtered = deliveries.filter((d) => {
    const matchesPlate = filterPlate === 'all' || d.vehiclePlate === filterPlate;
    const matchesSearch =
      d.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.driverName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.customerAddress.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesPlate && matchesSearch;
  });

  return (
    <div className="space-y-4">
      {/* Top Banner & Control Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Ortak Saha & Ekip Canlı Teslimat Akışı
            </h2>
            <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Canlı Takip
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Tüm araçların ve şoförlerin teslimatları anlık olarak bu ekrana düşer. Mükerrer dağıtım önlenir.
          </p>
        </div>

        {/* Filter and search controls */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Müşteri veya şoför ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div className="relative shrink-0">
            <select
              value={filterPlate}
              onChange={(e) => setFilterPlate(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">Tüm Araçlar ({plates.length})</option>
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

      {/* Feed List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-slate-400 text-xs">
            Henüz bu kritere uyan bir teslimat kaydı bulunmuyor.
          </div>
        ) : (
          filtered.map((item) => {
            const timeStr = new Date(item.timestamp).toLocaleTimeString('tr-TR', {
              hour: '2-digit',
              minute: '2-digit',
            });
            const isMe = item.driverId === currentUser.id;

            return (
              <div
                key={item.id}
                className={`bg-white dark:bg-slate-900 rounded-2xl border p-4 sm:p-5 shadow-xs transition-all hover:shadow-md ${
                  isMe
                    ? 'border-sky-200 dark:border-sky-900/60 bg-sky-50/10'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                {/* Row 1: Header with vehicle, driver, customer & timestamp */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center font-bold text-xs shrink-0">
                      <Truck className="w-4 h-4 text-sky-600" />
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                          {item.vehiclePlate}
                        </span>
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {item.driverName} {isMe && '(Siz)'}
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
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-sky-600 shrink-0" />
                      <span className="text-sm font-bold text-slate-900 dark:text-white">
                        {item.customerName}
                      </span>
                      <span className="text-xs text-slate-400">· {item.customerAddress}</span>
                    </div>

                    {/* Delivered Products Badges */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {item.deliveredItems.map((prod, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium border border-slate-100 dark:border-slate-700"
                        >
                          <strong className="font-mono tabular-nums text-sky-600 dark:text-sky-400">
                            {prod.quantity}
                          </strong>{' '}
                          {prod.productName}{' '}
                          <span className="text-slate-400 font-normal">({prod.unitPrice} ₺)</span>
                        </span>
                      ))}
                    </div>

                    {/* Deposit empty containers */}
                    {(item.emptyContainersReceived?.damacana > 0 ||
                      item.emptyContainersReceived?.tup > 0) && (
                      <div className="flex items-center gap-1 text-[11px] font-medium text-orange-600 dark:text-orange-400">
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Alınan Boş Kap:</span>
                        {item.emptyContainersReceived.damacana > 0 && (
                          <strong className="font-mono">{item.emptyContainersReceived.damacana} Boş Damacana</strong>
                        )}
                        {item.emptyContainersReceived.tup > 0 && (
                          <strong className="font-mono">, {item.emptyContainersReceived.tup} Boş Tüp</strong>
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
                  <div className="bg-slate-50/80 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800 shrink-0 min-w-[200px] text-right space-y-1">
                    <div className="text-[11px] text-slate-500">Mal Bedeli / Tutar</div>
                    <div className="text-base font-extrabold font-mono text-slate-900 dark:text-white tabular-nums">
                      {item.deliveredGrandTotal.toLocaleString('tr-TR')} ₺
                    </div>

                    {/* Payment badges */}
                    <div className="flex items-center justify-end gap-1.5 pt-1">
                      {item.collectedPayment.cashAmount > 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          <Wallet className="w-3 h-3" />
                          {item.collectedPayment.cashAmount.toLocaleString('tr-TR')} ₺ Nakit
                        </span>
                      )}

                      {item.collectedPayment.posAmount > 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">
                          <CreditCard className="w-3 h-3" />
                          {item.collectedPayment.posAmount.toLocaleString('tr-TR')} ₺ POS
                        </span>
                      )}

                      {item.collectedPayment.totalCollected === 0 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                          Tahsilat Alınmadı (0 ₺)
                        </span>
                      )}
                    </div>

                    {item.collectedPayment.diffUncollected > 0 && (
                      <div className="text-[10px] text-amber-700 dark:text-amber-400 font-medium pt-0.5">
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

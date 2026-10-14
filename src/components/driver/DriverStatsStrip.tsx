import React from 'react';
import { Dispatch, Delivery, Product } from '../../types';
import { Droplet, RotateCcw, Wallet, CreditCard, Flame } from 'lucide-react';

interface DriverStatsStripProps {
  dispatch: Dispatch | null;
  deliveries: Delivery[];
  products?: Product[];
}

export const DriverStatsStrip: React.FC<DriverStatsStripProps> = ({
  dispatch,
  deliveries,
  products = [],
}) => {
  if (!dispatch) return null;

  // Filter deliveries belonging to this dispatch
  const currentDeliveries = deliveries.filter((d) => d.dispatchId === dispatch.id);

  // Set of all product IDs categorized as damacana or with damacana deposit
  const damacanaIds = new Set(
    products
      .filter((p) => p.category === 'damacana' || p.depositType === 'damacana')
      .map((p) => p.id)
  );
  if (damacanaIds.size === 0) {
    damacanaIds.add('prod_damacana_19l');
  }

  // 1. Calculate full damacana items remaining
  const loadedDamacana = dispatch.loadedItems
    .filter((i) => damacanaIds.has(i.productId))
    .reduce((sum, i) => sum + i.quantity, 0);
  
  let deliveredDamacana = 0;
  let collectedEmptyDamacana = 0;
  let collectedEmptyTup = 0;
  let cashTotal = 0;
  let posTotal = 0;

  currentDeliveries.forEach((del) => {
    cashTotal += del.collectedPayment.cashAmount || 0;
    posTotal += del.collectedPayment.posAmount || 0;
    collectedEmptyDamacana += del.emptyContainersReceived.damacana || 0;
    collectedEmptyTup += del.emptyContainersReceived.tup || 0;

    del.deliveredItems.forEach((item) => {
      if (damacanaIds.has(item.productId)) {
        deliveredDamacana += item.quantity;
      }
    });
  });

  const remainingDamacana = Math.max(0, loadedDamacana - deliveredDamacana);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
      {/* 1. Kalan Dolu Damacana */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
        <div>
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Arabada Kalan Dolu
          </span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-extrabold font-mono text-sky-600 dark:text-sky-400 tabular-nums">
              {remainingDamacana}
            </span>
            <span className="text-xs text-slate-400">/ {loadedDamacana} Damacana</span>
          </div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-600 flex items-center justify-center shrink-0">
          <Droplet className="w-5 h-5 fill-sky-600/20" />
        </div>
      </div>

      {/* 2. Toplanan Boş Damacana (Depoya Teslim Edilecek) */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
        <div>
          <span className="text-[11px] font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wider block">
            Toplanan Boş Damacana
          </span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-extrabold font-mono text-orange-600 dark:text-orange-400 tabular-nums">
              {collectedEmptyDamacana}
            </span>
            <span className="text-xs text-slate-400">Depoya İnecek</span>
          </div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-orange-50 dark:bg-orange-950/40 text-orange-600 flex items-center justify-center shrink-0">
          <RotateCcw className="w-5 h-5" />
        </div>
      </div>

      {/* 3. Toplanan Boş Tüp */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
        <div>
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Toplanan Boş Tüp
          </span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-extrabold font-mono text-slate-800 dark:text-slate-200 tabular-nums">
              {collectedEmptyTup}
            </span>
            <span className="text-xs text-slate-400">Adet Boş Tüp</span>
          </div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center shrink-0">
          <Flame className="w-5 h-5" />
        </div>
      </div>

      {/* 4. Kasadaki Fiili Nakit */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
        <div>
          <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
            Cepteki Fiili Nakit
          </span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
              {cashTotal.toLocaleString('tr-TR')}
            </span>
            <span className="text-xs font-semibold text-emerald-600">₺</span>
          </div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center shrink-0">
          <Wallet className="w-5 h-5" />
        </div>
      </div>

      {/* 5. Çekilen POS Toplamı */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between col-span-2 lg:col-span-1">
        <div>
          <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block">
            POS Kart Çekimleri
          </span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-extrabold font-mono text-indigo-600 dark:text-indigo-400 tabular-nums">
              {posTotal.toLocaleString('tr-TR')}
            </span>
            <span className="text-xs font-semibold text-indigo-600">₺</span>
          </div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 flex items-center justify-center shrink-0">
          <CreditCard className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
};

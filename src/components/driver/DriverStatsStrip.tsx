import React from 'react';
import { Dispatch, Delivery, Product, isGlassDamacana } from '../../types';
import { RotateCcw, Wallet, CreditCard, Flame } from 'lucide-react';
import { totalTupEmpty } from '../../services/depositRules';

const FullDamacanaIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M10 2h4a1 1 0 0 1 1 1v2c0 2 3 3 3 6v8a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-8c0-3 3-4 3-6V3a1 1 0 0 1 1-1Z"
      fill="currentColor"
      fillOpacity="0.15"
    />
    <path d="M7 14h10" />
    <path d="M8 18h8" />
  </svg>
);

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

  // Damacana ürünlerini plastik ve cam olarak iki gruba ayır. Cam damacana,
  // aynı "damacana" kategorisinde olup depositType = 'cam_damacana' taşır.
  const damacanaProducts = products.filter(
    (p) => p.category === 'damacana' || p.depositType === 'damacana'
  );
  const plasticDamacanaIds = new Set(
    damacanaProducts.filter((p) => !isGlassDamacana(p)).map((p) => p.id)
  );
  const glassDamacanaIds = new Set(
    damacanaProducts.filter((p) => isGlassDamacana(p)).map((p) => p.id)
  );

  const sumLoaded = (ids: Set<string>) =>
    dispatch.loadedItems
      .filter((i) => ids.has(i.productId))
      .reduce((sum, i) => sum + i.quantity, 0);

  // 1. Calculate full damacana items remaining
  const loadedPlasticDamacana = sumLoaded(plasticDamacanaIds);
  const loadedGlassDamacana = sumLoaded(glassDamacanaIds);
  
  let deliveredPlasticDamacana = 0;
  let deliveredGlassDamacana = 0;
  let collectedEmptyDamacana = 0;
  let collectedEmptyCamDamacana = 0;
  let collectedEmptyTup = 0;
  let cashTotal = 0;
  let posTotal = 0;

  currentDeliveries.forEach((del) => {
    cashTotal += del.collectedPayment.cashAmount || 0;
    posTotal += del.collectedPayment.posAmount || 0;
    collectedEmptyDamacana += del.emptyContainersReceived.damacana || 0;
    collectedEmptyCamDamacana += Number(del.emptyContainersReceived.camDamacana || del.emptyContainersReceived.cam_damacana) || 0;
    collectedEmptyTup += totalTupEmpty(del.emptyContainersReceived);

    del.deliveredItems.forEach((item) => {
      if (plasticDamacanaIds.has(item.productId)) {
        deliveredPlasticDamacana += item.quantity;
      } else if (glassDamacanaIds.has(item.productId)) {
        deliveredGlassDamacana += item.quantity;
      }
    });
  });

  const remainingPlasticDamacana = Math.max(
    0,
    loadedPlasticDamacana - deliveredPlasticDamacana
  );
  const remainingGlassDamacana = Math.max(
    0,
    loadedGlassDamacana - deliveredGlassDamacana
  );
  const showGlassDamacana = loadedGlassDamacana > 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      {/* 1. Kalan Dolu Damacana */}
      <div
        className={`bg-white  p-4 rounded-2xl border border-slate-200  shadow-xs ${
          showGlassDamacana ? "" : "flex items-center justify-between"
        }`}
      >
        {showGlassDamacana ? (
          <div className="w-full min-w-0">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
              Arabada Kalan Dolu
            </span>
            <div className="mt-1 divide-y divide-slate-100">
              {loadedPlasticDamacana > 0 && (
                <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0 py-1.5">
                  <span className="font-mono font-extrabold text-sm text-sky-600  tabular-nums">
                    {remainingPlasticDamacana} / {loadedPlasticDamacana}
                  </span>
                  <span className="text-[11px] font-semibold text-slate-500">
                    Damacana
                  </span>
                </div>
              )}
              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0 py-1.5">
                <span className="font-mono font-extrabold text-sm text-amber-600  tabular-nums">
                  {remainingGlassDamacana} / {loadedGlassDamacana}
                </span>
                <span className="text-[11px] font-semibold text-amber-600">
                  Cam Damacana
                </span>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div>
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Arabada Kalan Dolu
              </span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-2xl font-extrabold font-mono text-sky-600  tabular-nums">
                  {remainingPlasticDamacana}
                </span>
                <span className="text-xs text-slate-400">
                  / {loadedPlasticDamacana} Damacana
                </span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-sky-50  text-sky-600 flex items-center justify-center shrink-0">
              <FullDamacanaIcon className="w-6 h-6" />
            </div>
          </>
        )}
      </div>

      {/* 2. Toplanan Boş Damacana (Depoya Teslim Edilecek) */}
      <div className="bg-white  p-4 rounded-2xl border border-slate-200  shadow-xs flex items-center justify-between">
        <div>
          <span className="text-[11px] font-semibold text-orange-600  uppercase tracking-wider block">
            Toplanan Boş Damacana
          </span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-extrabold font-mono text-orange-600  tabular-nums">
              {collectedEmptyDamacana}
            </span>
            <span className="text-xs text-slate-400">Depoya İnecek</span>
          </div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-orange-50  text-orange-600 flex items-center justify-center shrink-0">
          <RotateCcw className="w-5 h-5" />
        </div>
      </div>

      {/* 3. Toplanan Boş Cam Damacana (Depoya Teslim Edilecek) */}
      <div className="bg-white  p-4 rounded-2xl border border-slate-200  shadow-xs flex items-center justify-between">
        <div>
          <span className="text-[11px] font-semibold text-amber-600  uppercase tracking-wider block">
            Toplanan Boş Cam Damacana
          </span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-extrabold font-mono text-amber-600  tabular-nums">
              {collectedEmptyCamDamacana}
            </span>
            <span className="text-xs text-slate-400">Depoya İnecek</span>
          </div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-amber-50  text-amber-600 flex items-center justify-center shrink-0">
          <RotateCcw className="w-5 h-5" />
        </div>
      </div>

      {/* 4. Toplanan Boş Tüp */}
      <div className="bg-white  p-4 rounded-2xl border border-slate-200  shadow-xs flex items-center justify-between">
        <div>
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Toplanan Boş Tüp
          </span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-extrabold font-mono text-slate-800  tabular-nums">
              {collectedEmptyTup}
            </span>
            <span className="text-xs text-slate-400">Adet Boş Tüp</span>
          </div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-amber-50  text-amber-600 flex items-center justify-center shrink-0">
          <Flame className="w-5 h-5" />
        </div>
      </div>

      {/* 5. Kasadaki Fiili Nakit */}
      <div className="bg-white  p-4 rounded-2xl border border-slate-200  shadow-xs flex items-center justify-between">
        <div>
          <span className="text-[11px] font-semibold text-emerald-600  uppercase tracking-wider block">
            Cepteki Fiili Nakit
          </span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-extrabold font-mono text-emerald-600  tabular-nums">
              {cashTotal.toLocaleString('tr-TR')}
            </span>
            <span className="text-xs font-semibold text-emerald-600">₺</span>
          </div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-emerald-50  text-emerald-600 flex items-center justify-center shrink-0">
          <Wallet className="w-5 h-5" />
        </div>
      </div>

      {/* 6. Çekilen POS Toplamı */}
      <div className="bg-white  p-4 rounded-2xl border border-slate-200  shadow-xs flex items-center justify-between">
        <div>
          <span className="text-[11px] font-semibold text-indigo-600  uppercase tracking-wider block">
            POS Kart Çekimleri
          </span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-extrabold font-mono text-indigo-600  tabular-nums">
              {posTotal.toLocaleString('tr-TR')}
            </span>
            <span className="text-xs font-semibold text-indigo-600">₺</span>
          </div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-indigo-50  text-indigo-600 flex items-center justify-center shrink-0">
          <CreditCard className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
};

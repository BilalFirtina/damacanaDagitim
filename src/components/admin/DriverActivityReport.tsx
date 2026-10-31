import React, { useMemo } from 'react';
import { Delivery, Dispatch } from '../../types';
import { Truck, AlertCircle } from 'lucide-react';

const moneyFmt = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(value: number): string {
  return `${moneyFmt.format(Number(value) || 0)} ₺`;
}

const statusLabel: Record<string, string> = {
  pending_confirmation: 'Yükleme Onayı Bekliyor',
  in_transit: 'Dağıtımda',
  completed: 'Kapatıldı',
};

interface DriverActivityReportProps {
  dispatches: Dispatch[];
  deliveries: Delivery[];
  date: string;
}

// AGENTS.md Bölüm 10.2 — Şoför faaliyet ve dağıtım seferi raporu.
// Veri, günlük rapor yanıtındaki sefer ve teslimat kayıtlarından türetilir.
export const DriverActivityReport: React.FC<DriverActivityReportProps> = ({
  dispatches,
  deliveries,
  date,
}) => {
  const rows = useMemo(() => {
    const byDriver = new Map<
      string,
      {
        driverId: string;
        driverName: string;
        plates: Set<string>;
        statuses: Set<string>;
        deliveryCount: number;
        customers: Set<string>;
        sales: number;
        cash: number;
        pos: number;
        unpaid: number;
        emptyDamacana: number;
        emptyCamDamacana: number;
        emptyTup: number;
      }
    >();

    const ensure = (driverId: string, driverName: string) => {
      if (!byDriver.has(driverId)) {
        byDriver.set(driverId, {
          driverId,
          driverName,
          plates: new Set(),
          statuses: new Set(),
          deliveryCount: 0,
          customers: new Set(),
          sales: 0,
          cash: 0,
          pos: 0,
          unpaid: 0,
          emptyDamacana: 0,
          emptyCamDamacana: 0,
          emptyTup: 0,
        });
      }
      return byDriver.get(driverId)!;
    };

    for (const dispatch of dispatches) {
      const row = ensure(dispatch.driverId, dispatch.driverName || 'Bilinmeyen Şoför');
      if (dispatch.vehiclePlate) row.plates.add(dispatch.vehiclePlate);
      row.statuses.add(dispatch.status);
    }

    for (const delivery of deliveries) {
      const row = ensure(delivery.driverId, delivery.driverName || 'Bilinmeyen Şoför');
      if (delivery.vehiclePlate) row.plates.add(delivery.vehiclePlate);
      row.deliveryCount += 1;
      row.customers.add(delivery.customerId);
      row.sales += Number(delivery.deliveredGrandTotal) || 0;
      row.cash += Number(delivery.collectedPayment?.cashAmount) || 0;
      row.pos += Number(delivery.collectedPayment?.posAmount) || 0;
      if (Number(delivery.collectedPayment?.diffUncollected) > 0) {
        row.unpaid += Number(delivery.collectedPayment.diffUncollected) || 0;
      }
      row.emptyDamacana += Number(delivery.emptyContainersReceived?.damacana) || 0;
      row.emptyCamDamacana +=
        Number(
          delivery.emptyContainersReceived?.camDamacana ??
            (delivery.emptyContainersReceived as any)?.cam_damacana
        ) || 0;
      row.emptyTup += Number(delivery.emptyContainersReceived?.tup) || 0;
    }

    return Array.from(byDriver.values())
      .map((row) => ({
        ...row,
        plateText: Array.from(row.plates).join(', ') || '-',
        statusText: Array.from(row.statuses)
          .map((s) => statusLabel[s] || s)
          .join(' / '),
      }))
      .sort((a, b) => b.sales - a.sales || a.driverName.localeCompare(b.driverName, 'tr'));
  }, [dispatches, deliveries]);

  if (rows.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-10 text-center text-xs text-slate-400">
        Seçilen tarihte şoför faaliyeti bulunmuyor.
      </div>
    );
  }

  return (
    <div className="space-y-3 w-full max-w-full min-w-0">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">
          Şoför Faaliyet Raporu
        </h2>
        <p className="text-xs text-slate-500">
          {new Date(`${date}T00:00:00.000Z`).toLocaleDateString('tr-TR')} · {rows.length} şoför
        </p>
      </div>

      {rows.map((row) => (
        <div
          key={row.driverId}
          className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5 min-w-0"
        >
          <div className="flex items-start justify-between gap-3 min-w-0">
            <div className="min-w-0">
              <div className="font-bold text-sm text-slate-900 dark:text-white break-words">
                {row.driverName}
              </div>
              <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="inline-flex items-center gap-1">
                  <Truck className="w-3.5 h-3.5" />
                  <span className="font-mono break-words">{row.plateText}</span>
                </span>
                <span>·</span>
                <span className="break-words">{row.statusText || 'Sefer Kaydı Yok'}</span>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-mono font-bold text-sm text-slate-900 dark:text-white tabular-nums">
                {money(row.sales)}
              </div>
              <div className="text-[10px] text-slate-400">{row.deliveryCount} teslimat</div>
            </div>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <div className="min-w-0">
              <dt className="text-slate-500">Nakit</dt>
              <dd className="font-mono font-bold text-emerald-600 dark:text-emerald-300 tabular-nums break-words">
                {money(row.cash)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-slate-500">POS</dt>
              <dd className="font-mono font-bold text-indigo-600 dark:text-indigo-300 tabular-nums break-words">
                {money(row.pos)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-slate-500">Cariye Kalan</dt>
              <dd className="font-mono font-bold text-amber-600 dark:text-amber-300 tabular-nums break-words">
                {money(row.unpaid)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-slate-500">Ziyaret / Müşteri</dt>
              <dd className="font-mono font-bold text-slate-700 dark:text-slate-200 tabular-nums">
                {row.customers.size}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
            <span className="px-2 py-0.5 rounded bg-cyan-50 dark:bg-cyan-950/40 text-cyan-800 dark:text-cyan-200">
              {row.emptyDamacana} Boş Damacana
            </span>
            <span className="px-2 py-0.5 rounded bg-cyan-50 dark:bg-cyan-950/40 text-cyan-800 dark:text-cyan-200">
              {row.emptyCamDamacana} Boş Cam Damacana
            </span>
            <span className="px-2 py-0.5 rounded bg-cyan-50 dark:bg-cyan-950/40 text-cyan-800 dark:text-cyan-200">
              {row.emptyTup} Boş Tüp
            </span>
          </div>

          {row.unpaid > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-700 dark:text-amber-300">
              <AlertCircle className="w-3 h-3 shrink-0" />
              <span>Tahsil edilmeyen tutar cari borca işlendi; kasa toplamına dahil değildir.</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

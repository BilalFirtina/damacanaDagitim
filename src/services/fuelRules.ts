import type { FuelEntry } from '../types';
import { AUTHORIZED_VEHICLE_PLATES } from '../types';

export const INITIAL_FUEL_BALANCE_LITERS = 481.56;
export const FUEL_GENERAL_PLATE_LABEL = 'Genel Yakıt Yüklemesi';

const FUEL_PLATE_COLORS = ['#0ea5e9', '#10b981', '#f59e0b'];

export interface FuelConsumptionPoint {
  entryId: string;
  date: string;
  timestamp: number;
  value: number;
  mileageKm: number;
  liters: number;
  distanceKm: number;
}

export interface FuelPlateSeries {
  plate: string;
  color: string;
  points: FuelConsumptionPoint[];
  overallAverage: number | null;
  lastMileageKm: number | null;
  hasData: boolean;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function computeFuelBalance(entries: FuelEntry[]): number {
  let balance = INITIAL_FUEL_BALANCE_LITERS;
  for (const entry of entries) {
    if (entry.entryType === 'credit') balance += Number(entry.liters) || 0;
    else if (entry.entryType === 'purchase') balance -= Number(entry.liters) || 0;
  }
  return round2(balance);
}

export function computeLastMileage(
  entries: FuelEntry[],
  plate: string
): number | null {
  let last: number | null = null;
  for (const entry of entries) {
    if (entry.entryType !== 'purchase' || entry.plate !== plate) continue;
    const km = Number(entry.mileageKm);
    if (!Number.isFinite(km) || km <= 0) continue;
    if (last === null || km > last) last = km;
  }
  return last;
}

/**
 * Her plaka için yakıt alım aralıklarından L/100 km noktaları üretir.
 * İlk alım başlangıç kilometresidir; tüketim noktası üretmez.
 */
export function buildFuelConsumptionSeries(entries: FuelEntry[]): FuelPlateSeries[] {
  return AUTHORIZED_VEHICLE_PLATES.map((plate, index) => {
    const purchases = entries
      .filter(
        (entry) =>
          entry.entryType === 'purchase' &&
          entry.plate === plate &&
          Number(entry.mileageKm) > 0 &&
          Number(entry.liters) > 0
      )
      .sort((a, b) => {
        const kmDiff = Number(a.mileageKm) - Number(b.mileageKm);
        if (kmDiff !== 0) return kmDiff;
        return a.createdAt.localeCompare(b.createdAt);
      });

    const points: FuelConsumptionPoint[] = [];
    let previousKm: number | null = null;
    let totalDistance = 0;
    let totalLiters = 0;

    for (const purchase of purchases) {
      const km = Number(purchase.mileageKm);
      const liters = Number(purchase.liters);
      if (previousKm === null) {
        previousKm = km;
        continue;
      }
      const distanceKm = km - previousKm;
      if (distanceKm <= 0) continue;
      const value = (liters / distanceKm) * 100;
      const timestamp = Date.parse(`${purchase.entryDate}T00:00:00.000Z`);
      points.push({
        entryId: purchase.id,
        date: purchase.entryDate,
        timestamp: Number.isFinite(timestamp) ? timestamp : Date.parse(purchase.createdAt),
        value: round2(value),
        mileageKm: km,
        liters,
        distanceKm,
      });
      totalDistance += distanceKm;
      totalLiters += liters;
      previousKm = km;
    }

    points.sort((a, b) => a.timestamp - b.timestamp);

    return {
      plate,
      color: FUEL_PLATE_COLORS[index % FUEL_PLATE_COLORS.length],
      points,
      overallAverage:
        totalDistance > 0 ? round2((totalLiters / totalDistance) * 100) : null,
      lastMileageKm: purchases.length
        ? Number(purchases[purchases.length - 1].mileageKm)
        : null,
      hasData: points.length > 0,
    };
  });
}

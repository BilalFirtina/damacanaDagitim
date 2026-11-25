import type { FuelEntry } from '../src/types';
import { AUTHORIZED_VEHICLE_PLATES } from '../src/types';
import {
  INITIAL_FUEL_BALANCE_LITERS,
  FUEL_GENERAL_PLATE_LABEL,
  buildFuelConsumptionSeries,
  computeFuelBalance,
  computeLastMileage,
} from '../src/services/fuelRules';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
    return;
  }
  failed += 1;
  console.log(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
}

function entry(overrides: Partial<FuelEntry> & Pick<FuelEntry, 'id' | 'entryType' | 'entryDate' | 'liters'>): FuelEntry {
  return {
    plate: null,
    amountTl: null,
    mileageKm: null,
    note: null,
    createdByUserId: 'u1',
    createdByUserName: 'Test Kullanıcı',
    createdAt: `${overrides.entryDate}T08:00:00.000Z`,
    ...overrides,
  };
}

const credit = (id: string, liters: number, amountTl: number | null = null) =>
  entry({ id, entryType: 'credit', entryDate: '2026-11-25', liters, amountTl });
const purchase = (
  id: string,
  plate: string,
  date: string,
  liters: number,
  mileageKm: number,
  amountTl = 1000
) =>
  entry({
    id,
    entryType: 'purchase',
    plate,
    entryDate: date,
    liters,
    mileageKm,
    amountTl,
  });

console.log('\n[yakıt bakiye ve tüketim]\n');

check('başlangıç bakiyesi 431,56 L', INITIAL_FUEL_BALANCE_LITERS === 431.56);
check('genel yükleme etiketi', FUEL_GENERAL_PLATE_LABEL === 'Genel Yakıt Yüklemesi');

const balanceEntries = [credit('c1', 100), purchase('p1', AUTHORIZED_VEHICLE_PLATES[0], '2026-11-25', 50, 1000)];
check('bakiye = 431,56 + 100 - 50', computeFuelBalance(balanceEntries) === 481.56);
check(
  'tüm kayıtlar silinince başlangıca döner',
  computeFuelBalance([]) === 431.56
);
check(
  'bakiye negatif olabilir',
  computeFuelBalance([purchase('p2', AUTHORIZED_VEHICLE_PLATES[0], '2026-11-25', 500, 2000)]) === -68.44
);
check(
  'TL tutarı bakiyeye etki etmez',
  computeFuelBalance([
    credit('c2', 10, 999999),
    purchase('p3', AUTHORIZED_VEHICLE_PLATES[0], '2026-11-25', 5, 3000, 888888),
  ]) === 436.56
);

const plate = AUTHORIZED_VEHICLE_PLATES[0];
const mileageEntries = [
  purchase('m1', plate, '2026-11-01', 50, 1000),
  purchase('m2', plate, '2026-11-05', 40, 1500),
  purchase('m3', plate, '2026-11-10', 24, 1800),
];
check('son kilometre en büyük değerdir', computeLastMileage(mileageEntries, plate) === 1800);
check('olmayan plaka için kilometre yok', computeLastMileage(mileageEntries, AUTHORIZED_VEHICLE_PLATES[1]) === null);

const series = buildFuelConsumptionSeries(mileageEntries);
check('3 araç serisi üretilir', series.length === 3);
check('her araç için sabit renk var', series.every((item) => /^#[0-9a-f]{6}$/i.test(item.color)));
check('ilk alım tüketim noktası üretmez', series[0].points.length === 2);
check('100 km tüketimi 8 L', series[0].points.every((point) => point.value === 8));
check('genel ortalama 8 L/100 km', series[0].overallAverage === 8);
check('diğer araçlarda veri yok', series[1].hasData === false && series[2].hasData === false);

const outOfOrder = [
  purchase('i1', plate, '2026-11-01', 50, 2000),
  purchase('i2', plate, '2026-11-02', 10, 1900),
  purchase('i3', plate, '2026-11-03', 30, 2300),
];
const orderedSeries = buildFuelConsumptionSeries(outOfOrder)[0];
check('alımlar kilometre sırasına göre hesaplanır', orderedSeries.points.length === 2);
check(
  'aralık tüketimleri doğru sırada',
  orderedSeries.points[0]?.value === 50 && orderedSeries.points[1]?.value === 10
);

console.log(`\nSonuç: ${passed} başarılı, ${failed} başarısız`);
if (failed > 0) process.exit(1);

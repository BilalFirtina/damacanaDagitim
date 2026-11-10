import React, { useEffect, useMemo, useState } from 'react';
import { Customer, User, Product } from '../../types';
import { fetchDailyReport } from '../../services/api';
import { todayUtcDateStr } from '../../services/dateWindow';
import { formatCustomerBalance } from '../../services/customerBalanceDisplay';
import {
  buildConsolidatedReport,
  rowCash,
  rowPos,
  type ConsolidatedRow,
  type ReportPayment,
} from '../../services/consolidatedReportRules';
import { Printer, Calendar, RefreshCw, FileText } from 'lucide-react';

interface ConsolidatedDailyReportProps {
  users: User[];
  products: Product[];
  customers?: Customer[];
  date?: string;
  onDateChange?: (date: string) => void;
  reportData?: any;
  loading?: boolean;
  onReload?: () => void;
}

const POS_ICON_SRC = '/pos%20simgesi.png';
const moneyFmt = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const money = (value: number) => `${moneyFmt.format(value)} ₺`;

const timeFmt = (ms: number) =>
  new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

const timeText = (row: ConsolidatedRow) => {
  if (!row.firstAt) return '-';
  return row.firstAt === row.lastAt
    ? timeFmt(row.firstAt)
    : `${timeFmt(row.firstAt)} – ${timeFmt(row.lastAt)}`;
};

// Dolu: plastik sayısı kendi satırında, cam damacana altında C.D satırında.
const fullLines = (row: ConsolidatedRow): string[] => {
  const lines: string[] = [];
  if (row.damacanaFull > 0) lines.push(String(row.damacanaFull));
  if (row.camDamacanaFull > 0) lines.push(`C.D - ${row.camDamacanaFull}`);
  return lines;
};

// Boş: aynı biçim, cam için C.B satırı.
const emptyLines = (row: ConsolidatedRow): string[] => {
  const lines: string[] = [];
  if (row.damacanaEmpty > 0) lines.push(String(row.damacanaEmpty));
  if (row.camDamacanaEmpty > 0) lines.push(`C.B - ${row.camDamacanaEmpty}`);
  return lines;
};

// Teslim edilen ürünler: her kalem ayrı satırda. Damacana ve cam damacana bu sütunda yer almaz.
const productLines = (row: ConsolidatedRow): string[] => {
  const lines = row.productLines.map(
    (line) => `${line.name} - ${line.quantity} ${line.unit || 'Adet'}`
  );
  if (row.tupBuyukFull > 0) lines.push(`Büyük Dolu - ${row.tupBuyukFull}`);
  if (row.tupKucukFull > 0) lines.push(`Küçük Dolu - ${row.tupKucukFull}`);
  if (row.tupLegacyFull > 0) lines.push(`Tüp - ${row.tupLegacyFull}`);
  if (row.tupBuyukEmpty > 0) lines.push(`Büyük Boş - ${row.tupBuyukEmpty}`);
  if (row.tupKucukEmpty > 0) lines.push(`Küçük Boş - ${row.tupKucukEmpty}`);
  if (row.tupEmpty > 0) lines.push(`Tüp Boş - ${row.tupEmpty}`);
  if (row.sebilGiven > 0) lines.push(`Sebil - ${row.sebilGiven} VERİLDİ`);
  if (row.sebilReceived > 0) lines.push(`Sebil - ${row.sebilReceived} ALINDI`);
  return lines;
};

const amountText = (row: ConsolidatedRow): string => {
  if (row.deliveryCount === 0) return '-';
  if (row.isAccount) return 'FATURALI';
  return money(row.deliveredAmount);
};

const balanceText = (row: ConsolidatedRow): string => {
  if (row.isAccount) return 'FATURALI';
  if (row.balance === null) return '-';
  return formatCustomerBalance(row.balance, money);
};

const LinesCell: React.FC<{ items: string[] }> = ({ items }) => {
  if (items.length === 0) return <span>-</span>;
  // Her kalem kendi blok satırında gösterilir; ekran, mobil kart ve
  // A4/PDF baskıda iki ürün asla aynı satıra gelmez.
  return (
    <div className="space-y-0.5">
      {items.map((item, index) => (
        <div key={`${index}-${item}`} className="block break-words">
          {item}
        </div>
      ))}
    </div>
  );
};

const CollectionCell: React.FC<{ cash: number; pos: number }> = ({ cash, pos }) => {
  if (cash <= 0 && pos <= 0) return <span>-</span>;
  return (
    <div className="flex flex-col items-end gap-0.5">
      {cash > 0 && <span>{money(cash)}</span>}
      {pos > 0 && (
        <span className="flex flex-col items-end">
          <span>{money(pos)}</span>
          <img src={POS_ICON_SRC} alt="" title="POS" className="w-5 h-5 object-contain" />
        </span>
      )}
    </div>
  );
};

export const ConsolidatedDailyReport: React.FC<ConsolidatedDailyReportProps> = ({
  users,
  products,
  customers = [],
  date,
  onDateChange,
  reportData: controlledReportData,
  loading: controlledLoading,
  onReload,
}) => {
  const todayStr = todayUtcDateStr();
  const [internalDate, setInternalDate] = useState<string>(todayStr);
  const [internalLoading, setInternalLoading] = useState<boolean>(false);
  const [internalReportData, setInternalReportData] = useState<any>(null);

  const selectedDate = date ?? internalDate;
  const setSelectedDate = onDateChange ?? setInternalDate;
  const isLoading = controlledLoading ?? internalLoading;
  const data = controlledReportData ?? internalReportData;

  const loadReport = async () => {
    if (onReload) {
      onReload();
      return;
    }
    try {
      setInternalLoading(true);
      const result = await fetchDailyReport(selectedDate, 'all');
      setInternalReportData(result);
    } catch (err: any) {
      console.error('Failed to load consolidated report', err);
    } finally {
      setInternalLoading(false);
    }
  };

  useEffect(() => {
    if (controlledReportData !== undefined) return;
    let cancelled = false;
    setInternalLoading(true);
    fetchDailyReport(selectedDate, 'all')
      .then((result) => {
        if (!cancelled) setInternalReportData(result);
      })
      .catch((err) => {
        console.error('Failed to load consolidated report', err);
      })
      .finally(() => {
        if (!cancelled) setInternalLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, controlledReportData]);

  const report = useMemo(
    () =>
      buildConsolidatedReport({
        deliveries: data?.deliveries || [],
        payments: (data?.customerPayments || []) as ReportPayment[],
        dispatches: data?.dispatches || [],
        products,
        customers,
        drivers: users
          .filter((u) => u.role === 'driver')
          .map((u) => ({ id: u.id, name: u.name })),
      }),
    [data, products, customers, users]
  );

  const { icmal } = report;

  const formattedDate = new Date(selectedDate + 'T00:00:00').toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  });

  const generalCollection = icmal.collectionTotal;
  const adminTotal = report.adminCash + report.adminPos;

  return (
    <div className="space-y-6 w-full max-w-full min-w-0">
      {/* Ekran kontrolleri (yazdırmada gizlenir) */}
      <div className="print:hidden bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-slate-700" />
            <span>Depo Yöneticisi Konsolide Gün Sonu Raporu</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Şoförlerin müşteri bazlı teslimat ve tahsilat dökümü, A4 baskı / PDF çıktısı
          </p>
          <p className="text-[11px] text-sky-700 mt-1">
            Faturalı müşterilerin tutar ve cari borç alanları FATURALI olarak yazılır; fiili nakit ve POS tahsilatları görünür.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <div className="relative">
            <input
              type="date"
              value={selectedDate}
              max={todayStr}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="pl-8 pr-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-semibold text-slate-800 focus:outline-none"
            />
            <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <button
            onClick={loadReport}
            disabled={isLoading}
            className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600"
            title="Raporu Yenile"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => window.print()}
            className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-black text-white font-bold text-xs flex items-center gap-2 shadow-sm transition-all active:scale-95"
          >
            <Printer className="w-4 h-4" />
            <span>Yazdır / PDF Olarak Kaydet</span>
          </button>
        </div>
      </div>

      {/* A4 yazdırılabilir belge */}
      <div className="bg-white text-black p-6 sm:p-10 rounded-2xl border border-black shadow-sm font-sans mx-auto max-w-5xl print:p-0 print:border-none print:shadow-none print:max-w-none print:m-0 print:w-full">
        <style dangerouslySetInnerHTML={{ __html: `
          @media print {
            body {
              background-color: #ffffff !important;
              color: #000000 !important;
            }
            @page {
              size: A4 portrait;
              margin: 10mm;
            }
            .print-avoid-break {
              page-break-inside: avoid;
            }
          }
        `}} />

        {/* Rapor başlığı */}
        <div className="border-b-2 border-black pb-4 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <div className="text-xl sm:text-2xl font-black uppercase tracking-wider text-black">
                Fırtına Gıda
              </div>
              <div className="text-sm font-bold uppercase tracking-tight text-black mt-0.5">
                Depo Yöneticisi Gün Sonu Konsolide Dağıtım ve Tahsilat Raporu
              </div>
            </div>
            <div className="text-left sm:text-right text-xs space-y-0.5 text-black">
              <div>
                <strong>Rapor Tarihi:</strong> {formattedDate}
              </div>
              <div>
                <strong>Düzenleyen:</strong> Depo Yöneticisi (Uğur Fırtına)
              </div>
              <div>
                <strong>Baskı / Döküm Zamanı:</strong>{' '}
                {new Date().toLocaleString('tr-TR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
          </div>
        </div>

        {/* I. Genel icmal */}
        <section className="mb-6 print-avoid-break">
          <div className="text-xs font-black uppercase tracking-wider mb-2 border-b border-black pb-1">
            I. Günlük Genel İcmal
          </div>
          <table className="w-full text-xs border border-black border-collapse">
            <tbody>
              <tr className="border-b border-black">
                <td className="p-2 font-bold border-r border-black w-1/4">Dağıtım Şoförü:</td>
                <td className="p-2 font-mono font-bold w-1/4 tabular-nums">{icmal.driverCount} Şoför</td>
                <td className="p-2 font-bold border-r border-l border-black w-1/4">Teslimat Sayısı:</td>
                <td className="p-2 font-mono font-bold w-1/4 tabular-nums">
                  {icmal.deliveryCount} Teslimat · {icmal.visitedCustomerCount} Müşteri
                </td>
              </tr>
              <tr className="border-b border-black">
                <td className="p-2 font-bold border-r border-black">Peşin Ciro (Mal Bedeli):</td>
                <td className="p-2 font-mono font-black text-sm tabular-nums">
                  {money(icmal.pesinCiro)}
                  {icmal.hasAccountDelivery && <span className="ml-2 text-[10px]">+ FATURALI</span>}
                </td>
                <td className="p-2 font-bold border-r border-l border-black">Cariye Kalan Borç (Peşin):</td>
                <td className="p-2 font-mono font-bold tabular-nums">{money(icmal.creditAdded)}</td>
              </tr>
              <tr className="border-b border-black">
                <td className="p-2 font-bold border-r border-black">Teslimat Tahsilatı (Nakit / POS):</td>
                <td className="p-2 font-mono font-bold tabular-nums">
                  {money(icmal.deliveryCash)} / {money(icmal.deliveryPos)}
                </td>
                <td className="p-2 font-bold border-r border-l border-black">Teslimat Dışı Tahsilat (Nakit / POS):</td>
                <td className="p-2 font-mono font-bold tabular-nums">
                  {money(icmal.standaloneCash)} / {money(icmal.standalonePos)}
                </td>
              </tr>
              <tr className="border-b border-black">
                <td className="p-2 font-bold border-r border-black">Genel Tahsilat Toplamı:</td>
                <td className="p-2 font-mono font-black text-sm tabular-nums">{money(generalCollection)}</td>
                <td className="p-2 font-bold border-r border-l border-black">Dolu Damacana / Cam / Tüp:</td>
                <td className="p-2 font-mono font-bold tabular-nums">
                  {icmal.damacanaFull} / {icmal.camDamacanaFull} / {icmal.tupFull}
                </td>
              </tr>
              <tr className="border-b border-black">
                <td className="p-2 font-bold border-r border-black">Boş Damacana / Cam / Tüp:</td>
                <td className="p-2 font-mono font-bold tabular-nums">
                  {icmal.damacanaEmpty} / {icmal.camDamacanaEmpty} /{' '}
                  {icmal.tupBuyukEmpty + icmal.tupKucukEmpty + icmal.tupEmpty}
                </td>
                <td className="p-2 font-bold border-r border-l border-black">Su Sebili Verildi / Alındı:</td>
                <td className="p-2 font-mono font-bold tabular-nums">
                  {icmal.sebilGiven} / {icmal.sebilReceived}
                </td>
              </tr>
              <tr className="border-b border-black">
                <td className="p-2 font-bold border-r border-black">Büyük Tüp Dolu / Boş:</td>
                <td className="p-2 font-mono font-bold tabular-nums">
                  {icmal.tupBuyukFull} / {icmal.tupBuyukEmpty}
                </td>
                <td className="p-2 font-bold border-r border-l border-black">Küçük Tüp Dolu / Boş:</td>
                <td className="p-2 font-mono font-bold tabular-nums">
                  {icmal.tupKucukFull} / {icmal.tupKucukEmpty}
                </td>
              </tr>
              {(icmal.tupLegacyFull > 0 || icmal.tupEmpty > 0) && (
                <tr className="border-b border-black">
                  <td className="p-2 font-bold border-r border-black">Eski Tek Tüp Dolu / Boş:</td>
                  <td className="p-2 font-mono font-bold tabular-nums">
                    {icmal.tupLegacyFull} / {icmal.tupEmpty}
                  </td>
                  <td className="p-2 border-r border-l border-black" colSpan={2}></td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* II. Tahsilat özeti */}
        <section className="mb-6 print-avoid-break">
          <div className="text-xs font-black uppercase tracking-wider mb-2 border-b border-black pb-1">
            II. Tahsilat Özeti
          </div>

          <div className="text-[11px] font-bold mb-1">A. Şoför Bazında Tahsilat</div>
          <table className="w-full text-xs border border-black border-collapse mb-4">
            <thead>
              <tr className="border-b border-black">
                <th className="p-2 border-r border-black text-left">Şoför</th>
                <th className="p-2 border-r border-black text-right">Nakit</th>
                <th className="p-2 border-r border-black text-right">POS</th>
                <th className="p-2 text-right">Toplam Tahsilat</th>
              </tr>
            </thead>
            <tbody>
              {report.drivers.map((section) => (
                <tr key={section.driverId} className="border-b border-black">
                  <td className="p-2 border-r border-black font-bold">{section.driverName}</td>
                  <td className="p-2 border-r border-black text-right font-mono tabular-nums">{money(section.cash)}</td>
                  <td className="p-2 border-r border-black text-right font-mono tabular-nums">{money(section.pos)}</td>
                  <td className="p-2 text-right font-mono font-bold tabular-nums">
                    {money(section.cash + section.pos)}
                  </td>
                </tr>
              ))}
              <tr className="border-b border-black">
                <td className="p-2 border-r border-black font-bold">Yönetici / Diğer</td>
                <td className="p-2 border-r border-black text-right font-mono tabular-nums">{money(report.adminCash)}</td>
                <td className="p-2 border-r border-black text-right font-mono tabular-nums">{money(report.adminPos)}</td>
                <td className="p-2 text-right font-mono font-bold tabular-nums">{money(adminTotal)}</td>
              </tr>
              <tr className="font-black">
                <td className="p-2 border-r border-black">Genel Toplam</td>
                <td className="p-2 border-r border-black text-right font-mono tabular-nums">
                  {money(icmal.deliveryCash + icmal.standaloneCash)}
                </td>
                <td className="p-2 border-r border-black text-right font-mono tabular-nums">
                  {money(icmal.deliveryPos + icmal.standalonePos)}
                </td>
                <td className="p-2 text-right font-mono tabular-nums">{money(generalCollection)}</td>
              </tr>
            </tbody>
          </table>

          <div className="text-[11px] font-bold mb-1">B. Müşteri Bazında Tahsilat</div>
          {report.customerPayments.length === 0 ? (
            <div className="p-3 text-center italic text-xs border border-black">
              Bu tarihte tahsilat kaydı bulunmuyor.
            </div>
          ) : (
            <table className="w-full text-xs border border-black border-collapse">
              <thead>
                <tr className="border-b border-black">
                  <th className="p-2 border-r border-black text-left">Şoför</th>
                  <th className="p-2 border-r border-black text-left">Müşteri</th>
                  <th className="p-2 border-r border-black text-left">Kaynak</th>
                  <th className="p-2 border-r border-black text-right">Tahsilat</th>
                  <th className="p-2 text-right">Toplam</th>
                </tr>
              </thead>
              <tbody>
                {report.customerPayments.map((row, index) => (
                  <tr key={`${row.driverName}-${row.customerName}-${index}`} className="border-b border-black">
                    <td className="p-2 border-r border-black">{row.driverName}</td>
                    <td className="p-2 border-r border-black font-bold break-words">{row.customerName}</td>
                    <td className="p-2 border-r border-black">{row.source}</td>
                    <td className="p-2 border-r border-black text-right">
                      <CollectionCell cash={row.cash} pos={row.pos} />
                    </td>
                    <td className="p-2 text-right font-mono font-bold tabular-nums">{money(row.cash + row.pos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* III. Ürün dökümü */}
        <section className="mb-6 print-avoid-break">
          <div className="text-xs font-black uppercase tracking-wider mb-2 border-b border-black pb-1">
            III. Gün İçinde Teslim Edilen Ürün ve Miktar Dökümü
          </div>
          <table className="w-full text-xs border border-black border-collapse text-left">
            <thead>
              <tr className="border-b border-black bg-white">
                <th className="p-2 border-r border-black w-10">S.No</th>
                <th className="p-2 border-r border-black">Ürün Tanımı</th>
                <th className="p-2 border-r border-black text-center w-20">Birim</th>
                <th className="p-2 text-center w-24">Toplam Miktar</th>
              </tr>
            </thead>
            <tbody>
              {report.products.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-3 text-center italic border-b border-black">
                    Seçilen tarihte teslimat kaydı bulunmuyor.
                  </td>
                </tr>
              ) : (
                report.products.map((line, index) => (
                  <tr key={line.productId} className="border-b border-black">
                    <td className="p-2 border-r border-black font-mono">{index + 1}</td>
                    <td className="p-2 border-r border-black font-bold">{line.name}</td>
                    <td className="p-2 border-r border-black text-center">{line.unit}</td>
                    <td className="p-2 text-center font-mono font-bold tabular-nums">
                      {line.quantity}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        {/* IV. Şoför bazında müşteri dökümü */}
        <section className="space-y-6">
          <div className="text-xs font-black uppercase tracking-wider mb-2 border-b border-black pb-1">
            IV. Şoför Bazında Müşteri Dökümü
          </div>

          {report.drivers.length === 0 ? (
            <div className="p-6 text-center text-xs italic border border-black">
              Bu tarihte sefere çıkan veya teslimat yapan şoför kaydı bulunmuyor.
            </div>
          ) : (
            report.drivers.map((section, driverIndex) => (
              <div key={section.driverId} className="border border-black print-avoid-break">
                <div className="p-3 bg-white border-b border-black flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-sm">#{driverIndex + 1}</span>
                    <span className="font-black text-sm uppercase">{section.driverName}</span>
                    <span className="text-xs font-bold">
                      · Araç Plakası: <span className="font-mono">{section.plates.join(', ') || 'Belirtilmedi'}</span>
                    </span>
                  </div>
                  <div className="text-xs font-medium">
                    Müşteri: <strong>{section.rows.length}</strong> · Nakit <strong>{money(section.cash)}</strong> · POS{' '}
                    <strong>{money(section.pos)}</strong>
                  </div>
                </div>

                {section.rows.length === 0 ? (
                  <div className="p-3 text-center italic text-xs">Bu şoför için kayıt bulunmuyor.</div>
                ) : (
                  <>
                    {/* Masaüstü ve yazdırma: tek tablo */}
                    <div className="hidden md:block print:block overflow-x-auto print:overflow-visible">
                      <table className="w-full table-fixed print:table-auto text-xs border-collapse text-left">
                        <thead>
                          <tr className="border-b border-black bg-white">
                            <th className="p-2 border-r border-black w-[3.5%] print:w-auto">No</th>
                            <th className="p-2 border-r border-black w-[5%] print:w-auto">Saat</th>
                            <th className="p-2 border-r border-black w-[14%] print:w-auto">Müşteri Adı</th>
                            <th className="p-2 border-r border-black text-center w-[6%] print:w-auto">Dolu</th>
                            <th className="p-2 border-r border-black text-center w-[6%] print:w-auto">Boş</th>
                            <th className="p-2 border-r border-black text-center w-[36%] print:w-auto">Teslim Edilen Ürünler</th>
                            <th className="p-2 border-r border-black text-right w-[7%] print:w-auto">Tutar</th>
                            <th className="p-2 border-r border-black text-right w-[7%] print:w-auto">Tahsilat</th>
                            <th className="p-2 border-r border-black text-right w-[7.5%] print:w-auto">Cari Borç</th>
                            <th className="p-2 w-[8%] print:w-auto">Not</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.map((row, index) => (
                            <tr key={row.key} className="border-b border-black align-top">
                              <td className="p-2 border-r border-black font-mono">{index + 1}</td>
                              <td className="p-1 border-r border-black font-mono">
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[11px]">{timeText(row)}</span>
                                  {row.hasLateDelivery && (
                                    <span className="inline-block w-fit max-w-full rounded bg-amber-100 px-0.5 py-0 text-[9px] font-bold leading-tight text-amber-900 break-words">
                                      Geç Teslimat
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="p-2 border-r border-black font-bold break-words">
                                {row.customerName}
                                {row.customerAddress && (
                                  <div className="text-[10px] font-normal mt-0.5">{row.customerAddress}</div>
                                )}
                              </td>
                              <td className="p-1.5 border-r border-black text-center font-mono">
                                <LinesCell items={fullLines(row)} />
                              </td>
                              <td className="p-1.5 border-r border-black text-center font-mono">
                                <LinesCell items={emptyLines(row)} />
                              </td>
                              <td className="p-2 border-r border-black font-medium text-center">
                                <div className="min-[1440px]:whitespace-nowrap">
                                  <LinesCell items={productLines(row)} />
                                </div>
                              </td>
                              <td className="p-1 border-r border-black text-right font-mono font-bold text-[10px] tabular-nums">
                                {amountText(row)}
                              </td>
                              <td className="p-2 border-r border-black text-right font-mono tabular-nums">
                                <CollectionCell cash={rowCash(row)} pos={rowPos(row)} />
                              </td>
                              <td className="p-1 border-r border-black text-right font-mono text-[10px] leading-tight tabular-nums">
                                {balanceText(row)}
                              </td>
                              <td className="p-2 text-[10px] break-words">
                                {row.notes.length ? row.notes.join(' · ') : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-white font-bold border-t-2 border-black">
                            <td colSpan={6} className="p-2 text-right border-r border-black uppercase">
                              {section.driverName} Ara Toplamı:
                            </td>
                            <td className="p-2 text-right font-mono border-r border-black tabular-nums">
                              {money(section.deliveredAmount)}
                            </td>
                            <td className="p-2 text-right font-mono border-r border-black tabular-nums">
                              <CollectionCell cash={section.cash} pos={section.pos} />
                            </td>
                            <td className="p-2 border-r border-black" />
                            <td className="p-2" />
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Mobil: yığılmış kartlar, yatay kaydırma yok */}
                    <div className="md:hidden print:hidden divide-y divide-black">
                      {section.rows.map((row, index) => (
                        <div key={row.key} className="p-3 space-y-2 min-w-0">
                          <div className="flex items-start justify-between gap-2 min-w-0">
                            <div className="min-w-0">
                              <div className="font-bold text-xs break-words">
                                {index + 1}. {row.customerName}
                              </div>
                              {row.customerAddress && (
                                <div className="text-[10px] break-words">{row.customerAddress}</div>
                              )}
                            </div>
                            <span className="shrink-0 text-right font-mono text-[10px]">
                              <span className="block">{timeText(row)}</span>
                              {row.hasLateDelivery && (
                                <span className="mt-0.5 inline-block rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-900">
                                  Geç Teslimat
                                </span>
                              )}
                            </span>
                          </div>
                          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                            <div className="min-w-0">
                              <dt className="font-semibold">Dolu</dt>
                              <dd className="font-mono"><LinesCell items={fullLines(row)} /></dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="font-semibold">Boş</dt>
                              <dd className="font-mono"><LinesCell items={emptyLines(row)} /></dd>
                            </div>
                            <div className="col-span-2 min-w-0">
                              <dt className="font-semibold">Teslim Edilen Ürünler</dt>
                              <dd className="break-words"><LinesCell items={productLines(row)} /></dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="font-semibold">Tutar</dt>
                              <dd className="font-mono font-bold tabular-nums">{amountText(row)}</dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="font-semibold">Tahsilat</dt>
                              <dd className="font-mono tabular-nums">
                                <CollectionCell cash={rowCash(row)} pos={rowPos(row)} />
                              </dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="font-semibold">Cari Borç</dt>
                              <dd className="font-mono tabular-nums break-words">{balanceText(row)}</dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="font-semibold">Not</dt>
                              <dd className="break-words">{row.notes.length ? row.notes.join(' · ') : '-'}</dd>
                            </div>
                          </dl>
                        </div>
                      ))}
                      <div className="p-3 text-[11px] font-bold grid grid-cols-2 gap-x-3 gap-y-1">
                        <div className="col-span-2 uppercase">{section.driverName} Ara Toplamı</div>
                        <div className="flex justify-between gap-2">
                          <span>Tutar</span>
                          <span className="font-mono tabular-nums">{money(section.deliveredAmount)}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span>Nakit</span>
                          <span className="font-mono tabular-nums">{money(section.cash)}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span>POS</span>
                          <span className="font-mono tabular-nums">{money(section.pos)}</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {section.returns.length > 0 && (
                  <div className="border-t-2 border-black">
                    {section.returns.map((ret, retIndex) => {
                      const hasEmpty =
                        ret.emptyDamacana > 0 ||
                        ret.emptyCamDamacana > 0 ||
                        ret.emptyTupBuyuk > 0 ||
                        ret.emptyTupKucuk > 0 ||
                        ret.sebilReceived > 0;

                      return (
                        <div
                          key={ret.dispatchId}
                          className="p-3 border-b border-black last:border-b-0 space-y-2 print-avoid-break"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                            <div className="text-xs font-black uppercase tracking-wide">
                              Depoya İade
                              {section.returns.length > 1 ? ` #${retIndex + 1}` : ''}
                            </div>
                            <div className="text-[11px] font-bold break-words">
                              Plaka: <span className="font-mono">{ret.vehiclePlate}</span> · Şoför:{' '}
                              {ret.driverName}
                            </div>
                          </div>

                          {hasEmpty && (
                            <div className="space-y-1">
                              <div className="text-[11px] font-bold uppercase tracking-wide">
                                Toplanan Boş Kap ve Ekipmanlar
                              </div>
                              <div className="overflow-x-auto print:overflow-visible">
                                <table className="w-full text-xs border border-black border-collapse text-left">
                                  <thead>
                                    <tr className="border-b border-black bg-white">
                                      <th className="p-2 border-r border-black">Kalem</th>
                                      <th className="p-2 text-right w-24">Adet</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ret.emptyDamacana > 0 && (
                                      <tr className="border-b border-black last:border-b-0">
                                        <td className="p-2 border-r border-black font-bold">Boş Damacana</td>
                                        <td className="p-2 text-right font-mono font-bold tabular-nums">
                                          {ret.emptyDamacana}
                                        </td>
                                      </tr>
                                    )}
                                    {ret.emptyCamDamacana > 0 && (
                                      <tr className="border-b border-black last:border-b-0">
                                        <td className="p-2 border-r border-black font-bold">Boş Cam Damacana</td>
                                        <td className="p-2 text-right font-mono font-bold tabular-nums">
                                          {ret.emptyCamDamacana}
                                        </td>
                                      </tr>
                                    )}
                                    {ret.emptyTupBuyuk > 0 && (
                                      <tr className="border-b border-black last:border-b-0">
                                        <td className="p-2 border-r border-black font-bold">Büyük Boş Tüp</td>
                                        <td className="p-2 text-right font-mono font-bold tabular-nums">
                                          {ret.emptyTupBuyuk}
                                        </td>
                                      </tr>
                                    )}
                                    {ret.emptyTupKucuk > 0 && (
                                      <tr className="border-b border-black last:border-b-0">
                                        <td className="p-2 border-r border-black font-bold">Küçük Boş Tüp</td>
                                        <td className="p-2 text-right font-mono font-bold tabular-nums">
                                          {ret.emptyTupKucuk}
                                        </td>
                                      </tr>
                                    )}
                                    {ret.sebilReceived > 0 && (
                                      <tr className="border-b border-black last:border-b-0">
                                        <td className="p-2 border-r border-black font-bold">Alınan Sebil</td>
                                        <td className="p-2 text-right font-mono font-bold tabular-nums">
                                          {ret.sebilReceived}
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {ret.remainingProducts.length > 0 && (
                            <div className="space-y-1">
                              <div className="text-[11px] font-bold uppercase tracking-wide">
                                Araçta Kalan Dolu/Satılmayan Ürünler
                              </div>
                              <div className="overflow-x-auto print:overflow-visible">
                                <table className="w-full text-xs border border-black border-collapse text-left">
                                  <thead>
                                    <tr className="border-b border-black bg-white">
                                      <th className="p-2 border-r border-black">Ürün</th>
                                      <th className="p-2 border-r border-black text-right w-20">Arabaya Yüklenen</th>
                                      <th className="p-2 border-r border-black text-right w-24">Teslim Edilen</th>
                                      <th className="p-2 text-right w-28">Depoya İndirilecek</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ret.remainingProducts.map((product) => (
                                      <tr
                                        key={product.productId}
                                        className="border-b border-black last:border-b-0 align-top"
                                      >
                                        <td className="p-2 border-r border-black font-bold break-words">
                                          {product.name}
                                        </td>
                                        <td className="p-2 border-r border-black text-right font-mono tabular-nums">
                                          {product.loaded}
                                        </td>
                                        <td className="p-2 border-r border-black text-right font-mono tabular-nums">
                                          {product.delivered}
                                        </td>
                                        <td className="p-2 text-right font-mono font-bold tabular-nums">
                                          {product.remaining} {product.unit}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </section>

        {/* V. İmzalar */}
        <div className="mt-8 pt-4 border-t-2 border-black print-avoid-break">
          <div className="text-xs font-black uppercase tracking-wider mb-4">V. Resmî Teslim ve Onay İmzaları</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 text-xs">
            <div className="border border-black p-4 space-y-8">
              <div className="space-y-1">
                <div className="font-bold uppercase">Kontrol ve Onay: Depo Yöneticisi</div>
                <div>
                  Yukarıda dökümü yapılan günlük teslimatlar, kasa nakitleri, POS slipleri ve boş kaplar sayılmış
                  olup mutabakat sağlanarak teslim alınmıştır.
                </div>
              </div>
              <div className="flex justify-between items-end pt-4 border-t border-black">
                <div>
                  <div><strong>Yetkili:</strong> Uğur Fırtına</div>
                  <div><strong>Tarih:</strong> {new Date().toLocaleDateString('tr-TR')}</div>
                </div>
                <div className="text-right">
                  <div className="italic text-[10px]">İmza / Kaşe</div>
                  <div className="h-10 w-24"></div>
                </div>
              </div>
            </div>

            <div className="border border-black p-4 space-y-8">
              <div className="space-y-1">
                <div className="font-bold uppercase">Teslim Eden: Dağıtım Şoförleri</div>
                <div>
                  Aracımdaki kalan dolu ürünleri depoya boşalttığımı, topladığım boş kapları ve tahsilat tutarlarını
                  eksiksiz teslim ettiğimi beyan ederim.
                </div>
              </div>
              <div className="flex justify-between items-end pt-4 border-t border-black">
                <div>
                  <div>
                    <strong>Şoförler:</strong> {report.drivers.map((d) => d.driverName).join(', ') || 'Şoför'}
                  </div>
                  <div><strong>Tarih:</strong> {new Date().toLocaleDateString('tr-TR')}</div>
                </div>
                <div className="text-right">
                  <div className="italic text-[10px]">Şoför İmzaları</div>
                  <div className="h-10 w-24"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

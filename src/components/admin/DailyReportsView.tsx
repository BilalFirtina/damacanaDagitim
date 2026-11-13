import React, { useState, useEffect } from 'react';
import { Customer, Delivery, User, Product } from '../../types';
import { isAccountCustomerDelivery } from '../../services/customerVisibility';
import { totalTupEmpty } from '../../services/depositRules';
import {
  FileSpreadsheet,
  Printer,
  Calendar,
  Filter,
  Search,
  Wallet,
  CreditCard,
  Droplet,
  RotateCcw,
  RefreshCw,
  FileText,
  History,
  AlertTriangle,
  Truck
} from 'lucide-react';
import { fetchDailyReport } from '../../services/api';
import { todayUtcDateStr, clampDateToToday } from '../../services/dateWindow';
import { ConsolidatedDailyReport } from './ConsolidatedDailyReport';
import { BalancesReportView } from './BalancesReportView';
import { DriverActivityReport } from './DriverActivityReport';
import { DiscrepancyReport } from './DiscrepancyReport';
import { AuditLogView } from './AuditLogView';

// Şoför faaliyeti, uyuşmazlık ve detaylı Excel görünümleri kodda korunur;
// bu bayrak açılırsa üst sekmelerde yeniden görünür.
const SHOW_LEGACY_REPORT_TABS = false;

interface DailyReportsViewProps {
  users: User[];
  products: Product[];
  currentUser?: User;
  customers?: Customer[];
}

export const DailyReportsView: React.FC<DailyReportsViewProps> = ({
  users,
  products,
  currentUser,
  customers = [],
}) => {
  const isDriver = currentUser?.role === 'driver';
  const todayStr = todayUtcDateStr();
  const [subTab, setSubTab] = useState<'consolidated' | 'detailed' | 'drivers' | 'discrepancies' | 'balances' | 'corrections' | 'history'>(
    'consolidated'
  );
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  // Gelecek tarih seçimi state'e yazılmaz; native takvim `max` sınırını
  // yok sayan mobil/PWA tarayıcılarda da bugüne çekilir.
  const handleSelectedDateChange = (value: string) => {
    if (!value) return;
    setSelectedDate(clampDateToToday(value, todayStr));
  };
  const [selectedDriverId, setSelectedDriverId] = useState<string>(
    isDriver && currentUser ? currentUser.id : 'all'
  );
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const effectiveDriverId = isDriver && currentUser ? currentUser.id : selectedDriverId;

  const loadReport = async () => {
    try {
      setLoading(true);
      // Konsolide rapor her zaman tüm şoförleri gösterir; diğer günlük
      // sekmeler seçili şoför filtresini kullanır.
      const reportDriverId =
        !isDriver && subTab === 'consolidated' ? 'all' : effectiveDriverId;
      const data = await fetchDailyReport(selectedDate, reportDriverId);
      setReportData(data);
    } catch (err: any) {
      console.error('Failed to load report', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [selectedDate, effectiveDriverId, subTab]);

  const deliveries: Delivery[] = reportData?.deliveries || [];

  const filteredDeliveries = deliveries.filter((d) => {
    return (
      d.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.driverName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.vehiclePlate.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  // Export to Excel / CSV with UTF-8 BOM for perfect Excel Turkish characters
  const handleExportCSV = () => {
    const term = searchTerm.trim().toLowerCase();
    const paymentsForExport = (reportData?.customerPayments || []).filter((payment: any) => {
      if (payment.method !== 'CASH' && payment.method !== 'POS') return false;
      if (effectiveDriverId !== 'all' && payment.collectedByUserId !== effectiveDriverId) {
        return false;
      }
      if (!term) return true;
      return (
        String(payment.customerName || '').toLowerCase().includes(term) ||
        String(payment.collectedByUserName || '').toLowerCase().includes(term)
      );
    });

    if (filteredDeliveries.length === 0 && paymentsForExport.length === 0) {
      alert('Dışa aktarılacak teslimat veya tahsilat verisi bulunmuyor');
      return;
    }

    const headers = [
      'Tarih',
      'Saat',
      'Plaka',
      'Şoför',
      'Müşteri Adı',
      'Müşteri Telefon',
      'Adres',
      'Teslim Edilen Ürünler',
      'Toplam Mal Bedeli (TL)',
      'Nakit Tahsilat (TL)',
      'POS Tahsilat (TL)',
      'Toplam Tahsil Edilen (TL)',
      'Cariye Kalan Borç (TL)',
      'Alınan Boş Damacana',
      'Alınan Boş Cam Damacana',
      'Alınan Boş Tüp',
      'Notlar',
      'Kaynak',
    ];

    const rows: string[] = filteredDeliveries.map((del) => {
      const timeStr = new Date(del.timestamp).toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const isAccount = isAccountCustomerDelivery(del, customers);
      const itemsStr = del.deliveredItems
        .map((i) => {
          const unit = products.find((p) => p.id === i.productId)?.unit;
          return `${i.productName} - ${i.quantity}${unit ? ` ${unit}` : ''}${
            isAccount ? '' : ` (${i.unitPrice} TL)`
          }`;
        })
        .join(' + ');

      return [
        `"${selectedDate}"`,
        `"${timeStr}"`,
        `"${del.vehiclePlate}"`,
        `"${del.driverName}"`,
        `"${del.customerName.replace(/"/g, '""')}"`,
        `"${del.customerPhone || ''}"`,
        `"${(del.customerAddress || '').replace(/"/g, '""')}"`,
        `"${itemsStr.replace(/"/g, '""')}"`,
        isAccount ? '' : del.deliveredGrandTotal,
        del.collectedPayment.cashAmount,
        del.collectedPayment.posAmount,
        del.collectedPayment.totalCollected,
        isAccount ? '' : del.collectedPayment.diffUncollected,
        del.emptyContainersReceived.damacana || 0,
        Number(del.emptyContainersReceived.camDamacana || del.emptyContainersReceived.cam_damacana) || 0,
        totalTupEmpty(del.emptyContainersReceived),
        `"${(del.notes || '').replace(/"/g, '""')}"`,
        del.isLateDelivery ? '"Teslimat - Geç Teslimat"' : '"Teslimat"',
      ].join(';');
    });

    for (const payment of paymentsForExport) {
      const paymentTime = new Date(payment.collectedAt).toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      rows.push(
        [
          `"${selectedDate}"`,
          `"${paymentTime}"`,
          '""',
          `"${String(payment.collectedByUserName || '').replace(/"/g, '""')}"`,
          `"${String(payment.customerName || '').replace(/"/g, '""')}"`,
          '""',
          '""',
          '"Teslimat dışı tahsilat"',
          '',
          payment.method === 'CASH' ? payment.amount : 0,
          payment.method === 'POS' ? payment.amount : 0,
          payment.amount,
          '',
          0,
          0,
          0,
          `"${String(payment.note || '').replace(/"/g, '""')}"`,
          '"Teslimat Dışı"',
        ].join(';')
      );
    }

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `SuDagitim_GunSonuRaporu_${selectedDate}_${selectedDriverId}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  const summary = reportData?.summary || {
    totalDeliveries: 0,
    totalCustomersVisited: 0,
    totalDeliveredValue: 0,
    totalCashCollected: 0,
    totalPosCollected: 0,
    totalGrandCollected: 0,
    totalCreditAdded: 0,
    totalEmptyDamacanaCollected: 0,
    totalEmptyCamDamacanaCollected: 0,
    totalEmptyTupCollected: 0,
    totalStandaloneCash: 0,
    totalStandalonePos: 0,
    totalStandaloneCollected: 0,
  };

  // Calculation of actual collections received by driver for the business day
  let driverCashCollected = 0;
  let driverPosCollected = 0;
  let driverEmptyDamacana = 0;
  let driverEmptyCamDamacana = 0;
  let driverEmptyTup = 0;
  let driverUncollected = 0;

  deliveries.forEach((d) => {
    driverCashCollected += Number(d.collectedPayment?.cashAmount) || 0;
    driverPosCollected += Number(d.collectedPayment?.posAmount) || 0;
    if (!isAccountCustomerDelivery(d, customers)) {
      driverUncollected += Number(d.collectedPayment?.diffUncollected) || 0;
    }
    driverEmptyDamacana += Number(d.emptyContainersReceived?.damacana) || 0;
    driverEmptyCamDamacana += Number(d.emptyContainersReceived?.camDamacana || d.emptyContainersReceived?.cam_damacana) || 0;
    driverEmptyTup += totalTupEmpty(d.emptyContainersReceived);
  });

  const driverStandalonePayments = (reportData?.customerPayments || []).filter(
    (payment: any) => payment.collectedByUserId === currentUser?.id
  );
  const driverStandaloneCash = driverStandalonePayments
    .filter((payment: any) => payment.method === 'CASH')
    .reduce((sum: number, payment: any) => sum + (Number(payment.amount) || 0), 0);
  const driverStandalonePos = driverStandalonePayments
    .filter((payment: any) => payment.method === 'POS')
    .reduce((sum: number, payment: any) => sum + (Number(payment.amount) || 0), 0);

  const driverTotalCollected =
    driverCashCollected + driverPosCollected + driverStandaloneCash + driverStandalonePos;

  // If logged in as driver, display only the simplified End-of-Day Collection Summary
  if (isDriver) {
    return (
      <div className="space-y-6 w-full max-w-full min-w-0">
        {/* Driver Summary Header */}
        <div className="bg-white  rounded-2xl border border-slate-200  p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-sky-600 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-sm">
                <Wallet className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 ">
                  Şoför Gün Sonu Tahsilat Özeti
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Şoför: <strong>{currentUser?.name}</strong>
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative w-full sm:w-auto">
              <input
                type="date"
                value={selectedDate}
                max={todayStr}
                onChange={(e) => handleSelectedDateChange(e.target.value)}
                className="w-full sm:w-auto pl-8 pr-3 py-2 rounded-xl border border-slate-200  bg-slate-50  text-xs font-semibold text-slate-800  focus:outline-none"
              />
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <button
              onClick={loadReport}
              disabled={loading}
              className="p-2 rounded-xl border border-slate-200  bg-white  text-slate-700  hover:bg-slate-50 text-xs font-semibold shrink-0"
              title="Yenile"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Primary Hero Card: Total Collected Amount */}
        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 rounded-3xl p-6 sm:p-8 text-white shadow-lg relative overflow-hidden">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <span className="text-xs uppercase font-bold tracking-wider text-emerald-100 bg-white/10 px-3 py-1 rounded-full backdrop-blur-xs inline-block">
                Fiilen Tahsil Edilen Toplam Tutar
              </span>
              <h3 className="text-3xl sm:text-4xl lg:text-5xl font-black font-mono tracking-tight tabular-nums">
                {driverTotalCollected.toLocaleString('tr-TR')} ₺
              </h3>
              <p className="text-xs text-emerald-100/90 max-w-md">
                Seçili günde müşterilerden elden teslim alınan gerçek nakit ve POS slipleri toplamıdır.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row md:flex-col gap-2 shrink-0 bg-white/10 backdrop-blur-md p-3.5 rounded-2xl border border-white/10">
              <div className="text-xs text-emerald-100 flex items-center justify-between gap-4">
                <span>Ziyaret Edilen Müşteri:</span>
                <strong className="font-mono text-white text-sm">{deliveries.length} Adet</strong>
              </div>
              <div className="text-xs text-emerald-100 flex items-center justify-between gap-4">
                <span>Rapor Tarihi:</span>
                <strong className="font-mono text-white text-sm">{selectedDate}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Breakdown Grid: Cash, POS, Empty Containers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white  p-5 rounded-2xl border border-slate-200  shadow-xs space-y-1">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>Nakit Tahsilat</span>
              <Wallet className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-black font-mono text-emerald-600  tabular-nums">
              {driverCashCollected.toLocaleString('tr-TR')} ₺
            </div>
            <p className="text-[11px] text-slate-400">Elden alınan nakit kasa</p>
          </div>

          <div className="bg-white  p-5 rounded-2xl border border-slate-200  shadow-xs space-y-1">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>POS / Banka Kartı</span>
              <CreditCard className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="text-2xl font-black font-mono text-indigo-600  tabular-nums">
              {driverPosCollected.toLocaleString('tr-TR')} ₺
            </div>
            <p className="text-[11px] text-slate-400">Banka slip toplamı</p>
          </div>

          <div className="bg-white  p-5 rounded-2xl border border-slate-200  shadow-xs space-y-1">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>Teslimat Dışı Tahsilat</span>
              <Wallet className="w-4 h-4 text-sky-600" />
            </div>
            <div className="text-2xl font-black font-mono text-sky-700  tabular-nums">
              {(driverStandaloneCash + driverStandalonePos).toLocaleString('tr-TR')} ₺
            </div>
            <p className="text-[11px] text-slate-400">
              Nakit {driverStandaloneCash.toLocaleString('tr-TR')} ₺ · POS{' '}
              {driverStandalonePos.toLocaleString('tr-TR')} ₺
            </p>
          </div>

          <div className="bg-white  p-5 rounded-2xl border border-slate-200  shadow-xs space-y-1">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>Toplanan Boş Damacana</span>
              <Droplet className="w-4 h-4 text-sky-600" />
            </div>
            <div className="text-2xl font-black font-mono text-slate-900  tabular-nums">
              {driverEmptyDamacana} Adet
            </div>
            <p className="text-[11px] text-slate-400">Depoya teslim edilecek boşlar</p>
          </div>

          <div className="bg-white  p-5 rounded-2xl border border-slate-200  shadow-xs space-y-1">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>Toplanan Boş Cam Damacana</span>
              <RotateCcw className="w-4 h-4 text-amber-600" />
            </div>
            <div className="text-2xl font-black font-mono text-slate-900  tabular-nums">
              {driverEmptyCamDamacana} Adet
            </div>
            <p className="text-[11px] text-slate-400">Depoya teslim edilecek boş cam damacanalar</p>
          </div>

          <div className="bg-white  p-5 rounded-2xl border border-slate-200  shadow-xs space-y-1">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>Toplanan Boş Tüp</span>
              <RotateCcw className="w-4 h-4 text-amber-600" />
            </div>
            <div className="text-2xl font-black font-mono text-slate-900  tabular-nums">
              {driverEmptyTup} Adet
            </div>
            <p className="text-[11px] text-slate-400">Depoya teslim edilecek tüpler</p>
          </div>
        </div>

        {/* Clear informative note distinguishing collections from uncollected deliveries */}
        <div className="p-4 rounded-2xl bg-slate-100  border border-slate-200  text-xs text-slate-600  space-y-1">
          <div className="font-bold text-slate-900  flex items-center gap-1.5">
            <span>ℹ️ Tahsilat Hesaplama Bilgisi</span>
          </div>
          <p>
            Yukarıdaki toplam yalnızca müşterilerden fiilen teslim alınan (elden alınan nakit para ve POS slipleri) tutarları gösterir. Peşin müşterilerde veresiye bırakılan bakiye ({driverUncollected.toLocaleString('tr-TR')} ₺) tahsilat toplamına dahil edilmemiştir.
          </p>
        </div>
      </div>
    );
  }

  const driversList = users.filter((u) => u.role === 'driver');

  return (
    <div className="space-y-6 w-full max-w-full min-w-0">
      {/* Sub-tab Navigation */}
      <div className="print:hidden flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 p-1.5 bg-slate-100  rounded-2xl w-full sm:w-fit max-w-full">
        <button
          onClick={() => setSubTab('consolidated')}
          className={`w-full sm:w-auto min-h-11 px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center sm:justify-start gap-2 text-left ${
            subTab === 'consolidated'
              ? 'bg-white  text-slate-900  shadow-xs'
              : 'text-slate-600  hover:text-slate-900 '
          }`}
        >
          <FileText className="w-4 h-4 shrink-0" />
          <span>Konsolide Gün Sonu Raporu (A4 / PDF Baskı)</span>
        </button>
        {SHOW_LEGACY_REPORT_TABS && (<>
        <button
          onClick={() => setSubTab('detailed')}
          className={`w-full sm:w-auto min-h-11 px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center sm:justify-start gap-2 text-left ${
            subTab === 'detailed'
              ? 'bg-white  text-slate-900  shadow-xs'
              : 'text-slate-600  hover:text-slate-900 '
          }`}
        >
          <FileSpreadsheet className="w-4 h-4 shrink-0" />
          <span>Detaylı Teslimat Listesi & Excel</span>
        </button>
        <button
          onClick={() => setSubTab('drivers')}
          className={`w-full sm:w-auto min-h-11 px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center sm:justify-start gap-2 text-left ${
            subTab === 'drivers'
              ? 'bg-white  text-slate-900  shadow-xs'
              : 'text-slate-600  hover:text-slate-900 '
          }`}
        >
          <Truck className="w-4 h-4 shrink-0" />
          <span>Şoför Faaliyet Raporu</span>
        </button>
        <button
          onClick={() => setSubTab('discrepancies')}
          className={`w-full sm:w-auto min-h-11 px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center sm:justify-start gap-2 text-left ${
            subTab === 'discrepancies'
              ? 'bg-white  text-slate-900  shadow-xs'
              : 'text-slate-600  hover:text-slate-900 '
          }`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Araçta Kalan & Kasa Uyuşmazlıkları</span>
        </button>
        </>)}
        <button
          onClick={() => setSubTab('balances')}
          className={`w-full sm:w-auto min-h-11 px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center sm:justify-start gap-2 text-left ${
            subTab === 'balances'
              ? 'bg-white  text-slate-900  shadow-xs'
              : 'text-slate-600  hover:text-slate-900 '
          }`}
        >
          <Wallet className="w-4 h-4 shrink-0" />
          <span>Cari & İade Edilebilir Bakiyeler</span>
        </button>
        <button
          onClick={() => setSubTab('corrections')}
          className={`w-full sm:w-auto min-h-11 px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center sm:justify-start gap-2 text-left ${
            subTab === 'corrections'
              ? 'bg-white  text-slate-900  shadow-xs'
              : 'text-slate-600  hover:text-slate-900 '
          }`}
        >
          <History className="w-4 h-4 shrink-0" />
          <span>Denetim Kayıtları</span>
        </button>
      </div>

      {subTab === 'consolidated' ? (
        <ConsolidatedDailyReport
          users={users}
          products={products}
          customers={customers}
          date={selectedDate}
          onDateChange={handleSelectedDateChange}
          reportData={reportData}
          loading={loading}
          onReload={loadReport}
        />
      ) : subTab === 'balances' ? (
        <BalancesReportView />
      ) : subTab === 'discrepancies' ? (
        <DiscrepancyReport dispatches={reportData?.dispatches || []} products={products} />
      ) : subTab === 'drivers' ? (
        <DriverActivityReport
          dispatches={reportData?.dispatches || []}
          deliveries={deliveries}
          payments={reportData?.customerPayments || []}
          customers={customers}
          date={selectedDate}
        />
      ) : subTab === 'corrections' ? (
        <AuditLogView customers={customers} />
      ) : (
        <>
          {/* Top Controls Filter Bar */}
      <div className="bg-white  rounded-2xl border border-slate-200  p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 ">
            Gün Sonu Dağıtım & Müşteri Teslimat Raporu
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Hangi şoförün hangi müşteriye ne verdiği, tahsilatları ve boş kap dökümü
          </p>
        </div>

        {/* Filter Controls & Actions */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* Date Picker */}
          <div className="relative">
            <input
              type="date"
              value={selectedDate}
              max={todayStr}
              onChange={(e) => handleSelectedDateChange(e.target.value)}
              className="pl-8 pr-3 py-2 rounded-xl border border-slate-200  bg-slate-50  text-xs font-semibold text-slate-800  focus:outline-none"
            />
            <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Driver Selector */}
          <div className="relative">
            <select
              value={selectedDriverId}
              onChange={(e) => setSelectedDriverId(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 rounded-xl border border-slate-200  bg-white  text-xs font-semibold text-slate-800  focus:outline-none"
            >
              <option value="all">Tüm Şoförler ({driversList.length})</option>
              {driversList.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <Filter className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Excel Export Button */}
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-all whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Excel (.CSV)</span>
          </button>

          {/* PDF Print Button */}
          <button
            onClick={handlePrint}
            className="px-3.5 py-2 rounded-xl border border-slate-200  bg-white  hover:bg-slate-50 text-slate-700  font-semibold text-xs flex items-center gap-1.5 shadow-xs whitespace-nowrap"
          >
            <Printer className="w-4 h-4 text-slate-500" />
            <span>PDF Yazdır</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white  p-3.5 rounded-xl border border-slate-200  shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Toplam Teslimat
          </span>
          <div className="text-xl font-extrabold font-mono text-slate-900  mt-1 tabular-nums">
            {summary.totalDeliveries} Adet
          </div>
          <span className="text-[10px] text-slate-400">{summary.totalCustomersVisited} Farklı Müşteri</span>
        </div>

        <div className="bg-white  p-3.5 rounded-xl border border-slate-200  shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Toplam Ciro (Mal)
          </span>
          <div className="text-xl font-extrabold font-mono text-slate-900  mt-1 tabular-nums">
            {summary.totalDeliveredValue.toLocaleString('tr-TR')} ₺
          </div>
          <span className="text-[10px] text-slate-400">Brüt Teslimat Tutarı</span>
        </div>

        <div className="bg-white  p-3.5 rounded-xl border border-emerald-200  bg-emerald-50/20 shadow-xs">
          <span className="text-[11px] font-semibold text-emerald-700  uppercase tracking-wider block">
            Fiili Nakit Kasa
          </span>
          <div className="text-xl font-extrabold font-mono text-emerald-600 mt-1 tabular-nums">
            {summary.totalCashCollected.toLocaleString('tr-TR')} ₺
          </div>
          <span className="text-[10px] text-emerald-600/80 font-medium">Teslim Edilecek Nakit</span>
        </div>

        <div className="bg-white  p-3.5 rounded-xl border border-indigo-200  bg-indigo-50/20 shadow-xs">
          <span className="text-[11px] font-semibold text-indigo-700  uppercase tracking-wider block">
            POS Kart Slip Toplamı
          </span>
          <div className="text-xl font-extrabold font-mono text-indigo-600 mt-1 tabular-nums">
            {summary.totalPosCollected.toLocaleString('tr-TR')} ₺
          </div>
          <span className="text-[10px] text-indigo-600/80 font-medium">Banka POS Çekimleri</span>
        </div>

        <div className="bg-white  p-3.5 rounded-xl border border-teal-200  bg-teal-50/20 shadow-xs">
          <span className="text-[11px] font-semibold text-teal-700  uppercase tracking-wider block">
            Teslimat Dışı Tahsilat
          </span>
          <div className="text-xl font-extrabold font-mono text-teal-600 mt-1 tabular-nums">
            {(summary.totalStandaloneCollected || 0).toLocaleString('tr-TR')} ₺
          </div>
          <span className="text-[10px] text-teal-600/80 font-medium break-words">
            Nakit {(summary.totalStandaloneCash || 0).toLocaleString('tr-TR')} ₺ · POS{' '}
            POS {(summary.totalStandalonePos || 0).toLocaleString('tr-TR')} ₺
          </span>
        </div>

        <div className="bg-white  p-3.5 rounded-xl border border-amber-200  bg-amber-50/20 shadow-xs">
          <span className="text-[11px] font-semibold text-amber-700  uppercase tracking-wider block">
            Cari / Veresiye
          </span>
          <div className="text-xl font-extrabold font-mono text-amber-600 mt-1 tabular-nums">
            {summary.totalCreditAdded.toLocaleString('tr-TR')} ₺
          </div>
          <span className="text-[10px] text-amber-600/80 font-medium">Müşteri Borcuna Yazılan</span>
        </div>

        <div className="bg-white  p-3.5 rounded-xl border border-orange-200  bg-orange-50/20 shadow-xs">
          <span className="text-[11px] font-semibold text-orange-700  uppercase tracking-wider block">
            Toplanan Boş Damacana
          </span>
          <div className="text-xl font-extrabold font-mono text-orange-600 mt-1 tabular-nums">
            {summary.totalEmptyDamacanaCollected} Adet
          </div>
          <span className="text-[10px] text-orange-600/80 font-medium">Depoya İnecek Boş</span>
        </div>

        <div className="bg-white  p-3.5 rounded-xl border border-amber-200  bg-amber-50/20 shadow-xs">
          <span className="text-[11px] font-semibold text-amber-700  uppercase tracking-wider block">
            Toplanan Boş Cam Damacana
          </span>
          <div className="text-xl font-extrabold font-mono text-amber-600 mt-1 tabular-nums">
            {summary.totalEmptyCamDamacanaCollected} Adet
          </div>
          <span className="text-[10px] text-amber-600/80 font-medium">Depoya İnecek Boş Cam</span>
        </div>
      </div>

      {summary.hasAccountCustomerDeliveries && (
        <div className="rounded-xl border border-sky-200  bg-sky-50/60  p-3 text-[11px] text-sky-800 ">
          Faturalı müşterilerin birim fiyat, mal tutarı ve cari borç bilgileri
          FATURALI olarak yazılır; bu tutarlar rapor toplamlarına dahil edilmez.
        </div>
      )}

      {/* Deliveries Data Table */}
      <div className="bg-white  rounded-2xl border border-slate-200  p-3 sm:p-5 shadow-xs space-y-4 w-full max-w-full min-w-0 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 ">
          <div className="text-xs font-bold text-slate-800 ">
            Müşteri Bazlı Teslim Edilen Ürün & Tahsilat Dökümü ({filteredDeliveries.length} Kayıt)
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Tabloda müşteri veya şoför ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200  text-xs bg-slate-50 "
            />
          </div>
        </div>

        {filteredDeliveries.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            Seçilen tarih ve kriterlere uygun teslimat kaydı bulunamadı.
          </div>
        ) : (
          <>
          <div className="hidden md:block overflow-x-auto print:overflow-visible w-full max-w-full">
            <table className="w-full text-left text-xs border-collapse min-w-[700px]">
              <thead>
                <tr className="border-b border-slate-200  text-slate-500 font-semibold bg-slate-50/50 ">
                  <th className="py-2.5 px-3">Saat</th>
                  <th className="py-2.5 px-3">Şoför / Plaka</th>
                  <th className="py-2.5 px-3">Müşteri & Adres</th>
                  <th className="py-2.5 px-3">Teslim Edilen Ürünler</th>
                  <th className="py-2.5 px-3 text-center">Boş Kap</th>
                  <th className="py-2.5 px-3 text-right">Mal Tutarı</th>
                  <th className="py-2.5 px-3 text-right">Nakit</th>
                  <th className="py-2.5 px-3 text-right">POS Kart</th>
                  <th className="py-2.5 px-3 text-right">Cari Borç</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 ">
                {filteredDeliveries.map((del) => {
                  const timeStr = new Date(del.timestamp).toLocaleTimeString('tr-TR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  const isAccount = isAccountCustomerDelivery(del, customers);

                  return (
                    <tr key={del.id} className="hover:bg-slate-50/80 ">
                      <td className="py-3 px-3 font-mono text-slate-500 whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          <span>{timeStr}</span>
                          {del.isLateDelivery && (
                            <span className="w-fit rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-900">
                              Geç Teslimat
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="font-semibold text-slate-900 ">
                          {del.driverName}
                        </div>
                        <div className="font-mono text-[10px] text-slate-400">
                          {del.vehiclePlate}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-900 ">
                          {del.customerName}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate max-w-xs">
                          {del.customerAddress}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex flex-col items-start gap-1">
                          {del.deliveredItems.map((item, idx) => {
                            const unit = products.find((p) => p.id === item.productId)?.unit;
                            return (
                              <span
                                key={idx}
                                className="px-2 py-0.5 rounded bg-slate-100  text-[11px] break-words max-w-full"
                              >
                                {item.productName} - <strong>{item.quantity}</strong>
                                {unit ? ` ${unit}` : ''}
                                {!isAccount && (
                                  <span className="text-slate-500"> ({item.unitPrice} ₺)</span>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        {del.emptyContainersReceived.damacana > 0 ||
                        (del.emptyContainersReceived.camDamacana || 0) > 0 ||
                        (del.emptyContainersReceived.tupBuyuk || 0) > 0 ||
                        (del.emptyContainersReceived.tupKucuk || 0) > 0 ? (
                          <div className="flex flex-col items-center gap-0.5">
                            {del.emptyContainersReceived.damacana > 0 && (
                              <span className="font-mono font-bold text-orange-600">
                                {del.emptyContainersReceived.damacana} Boş
                              </span>
                            )}
                            {(del.emptyContainersReceived.camDamacana || 0) > 0 && (
                              <span className="font-mono font-bold text-amber-600">
                                {del.emptyContainersReceived.camDamacana} Boş Cam
                              </span>
                            )}
                            {(del.emptyContainersReceived.tupBuyuk || 0) > 0 && (
                              <span className="font-mono font-bold text-slate-600">
                                {del.emptyContainersReceived.tupBuyuk} Boş Büyük Tüp
                              </span>
                            )}
                            {(del.emptyContainersReceived.tupKucuk || 0) > 0 && (
                              <span className="font-mono font-bold text-slate-600">
                                {del.emptyContainersReceived.tupKucuk} Boş Küçük Tüp
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900  tabular-nums">
                        {isAccount ? (
                          <span className="text-[10px] font-semibold text-slate-400">FATURALI</span>
                        ) : (
                          `${del.deliveredGrandTotal.toLocaleString('tr-TR')} ₺`
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {del.collectedPayment.cashAmount > 0 ? (
                          <span className="font-bold text-emerald-600">
                            {del.collectedPayment.cashAmount.toLocaleString('tr-TR')} ₺
                          </span>
                        ) : (
                          <span className="text-slate-300">0 ₺</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {del.collectedPayment.posAmount > 0 ? (
                          <span className="font-bold text-indigo-600">
                            {del.collectedPayment.posAmount.toLocaleString('tr-TR')} ₺
                          </span>
                        ) : (
                          <span className="text-slate-300">0 ₺</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {isAccount ? (
                          <span className="text-[10px] font-semibold text-slate-400">FATURALI</span>
                        ) : del.collectedPayment.diffUncollected > 0 ? (
                          <span className="font-bold text-amber-600">
                            +{del.collectedPayment.diffUncollected.toLocaleString('tr-TR')} ₺
                          </span>
                        ) : (
                          <span className="text-emerald-600 font-semibold">Kapandı</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobil: geniş tablo yerine yığılmış kartlar (AGENTS.md Bölüm 11).
              Yatay sayfa kaydırması gerekmez; tüm tutarlar görünür kalır. */}
          <div className="md:hidden space-y-3">
            {filteredDeliveries.map((del) => {
              const timeStr = new Date(del.timestamp).toLocaleTimeString('tr-TR', {
                hour: '2-digit',
                minute: '2-digit',
              });
              const isAccount = isAccountCustomerDelivery(del, customers);
              const hasEmpties =
                del.emptyContainersReceived.damacana > 0 ||
                (del.emptyContainersReceived.camDamacana || 0) > 0 ||
                (del.emptyContainersReceived.tupBuyuk || 0) > 0 ||
                (del.emptyContainersReceived.tupKucuk || 0) > 0;

              return (
                <div
                  key={del.id}
                  className="rounded-2xl border border-slate-200  bg-white  p-3.5 space-y-2.5 min-w-0"
                >
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900  break-words">
                        {del.customerName}
                      </div>
                      <div className="text-[11px] text-slate-500 break-words">
                        {del.customerAddress}
                      </div>
                    </div>
                    <span className="shrink-0 text-right font-mono text-[11px] text-slate-500">
                      <span className="block">{timeStr}</span>
                      {del.isLateDelivery && (
                        <span className="mt-0.5 inline-block rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-900">
                          Geç Teslimat
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-600  break-words">
                    {del.driverName} · <span className="font-mono">{del.vehiclePlate}</span>
                  </div>

                  <div className="flex flex-col items-start gap-1">
                    {del.deliveredItems.map((item, idx) => {
                      const unit = products.find((p) => p.id === item.productId)?.unit;
                      return (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded bg-slate-100  text-[11px] break-words max-w-full"
                        >
                          {item.productName} - <strong>{item.quantity}</strong>
                          {unit ? ` ${unit}` : ''}
                          {!isAccount && (
                            <span className="text-slate-500"> ({item.unitPrice} ₺)</span>
                          )}
                        </span>
                      );
                    })}
                  </div>

                  {hasEmpties && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono font-bold">
                      {del.emptyContainersReceived.damacana > 0 && (
                        <span className="text-orange-600">
                          {del.emptyContainersReceived.damacana} Boş
                        </span>
                      )}
                      {(del.emptyContainersReceived.camDamacana || 0) > 0 && (
                        <span className="text-amber-600">
                          {del.emptyContainersReceived.camDamacana} Boş Cam
                        </span>
                      )}
                      {(del.emptyContainersReceived.tupBuyuk || 0) > 0 && (
                        <span className="text-slate-600">
                          {del.emptyContainersReceived.tupBuyuk} Boş Büyük Tüp
                        </span>
                      )}
                      {(del.emptyContainersReceived.tupKucuk || 0) > 0 && (
                        <span className="text-slate-600">
                          {del.emptyContainersReceived.tupKucuk} Boş Küçük Tüp
                        </span>
                      )}
                    </div>
                  )}

                  <dl className="grid grid-cols-2 gap-2 text-[11px] border-t border-slate-100  pt-2">
                    <div className="min-w-0">
                      <dt className="text-slate-500">Mal Tutarı</dt>
                      <dd className="font-mono font-bold text-slate-900  tabular-nums break-words">
                        {isAccount ? (
                          <span className="text-[10px] font-semibold text-slate-400">FATURALI</span>
                        ) : (
                          `${del.deliveredGrandTotal.toLocaleString('tr-TR')} ₺`
                        )}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-slate-500">Nakit</dt>
                      <dd className="font-mono font-bold tabular-nums break-words">
                        {del.collectedPayment.cashAmount > 0 ? (
                          <span className="text-emerald-600">
                            {del.collectedPayment.cashAmount.toLocaleString('tr-TR')} ₺
                          </span>
                        ) : (
                          <span className="text-slate-400">0 ₺</span>
                        )}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-slate-500">POS Kart</dt>
                      <dd className="font-mono font-bold tabular-nums break-words">
                        {del.collectedPayment.posAmount > 0 ? (
                          <span className="text-indigo-600">
                            {del.collectedPayment.posAmount.toLocaleString('tr-TR')} ₺
                          </span>
                        ) : (
                          <span className="text-slate-400">0 ₺</span>
                        )}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-slate-500">Cari Borç</dt>
                      <dd className="font-mono font-bold tabular-nums break-words">
                        {isAccount ? (
                          <span className="text-[10px] font-semibold text-slate-400">FATURALI</span>
                        ) : del.collectedPayment.diffUncollected > 0 ? (
                          <span className="text-amber-600">
                            +{del.collectedPayment.diffUncollected.toLocaleString('tr-TR')} ₺
                          </span>
                        ) : (
                          <span className="text-emerald-600">Kapandı</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
          </>
        )}
      </div>
        </>
      )}
    </div>
  );
};

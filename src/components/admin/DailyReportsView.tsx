import React, { useState, useEffect } from 'react';
import { Delivery, User, Product } from '../../types';
import {
  FileSpreadsheet,
  Printer,
  Calendar,
  Filter,
  Search,
  Wallet,
  CreditCard,
  Building2,
  Droplet,
  RotateCcw,
  RefreshCw,
  FileText
} from 'lucide-react';
import { fetchDailyReport } from '../../services/api';
import { ConsolidatedDailyReport } from './ConsolidatedDailyReport';

interface DailyReportsViewProps {
  users: User[];
  products: Product[];
  currentUser?: User;
}

export const DailyReportsView: React.FC<DailyReportsViewProps> = ({
  users,
  products,
  currentUser,
}) => {
  const isDriver = currentUser?.role === 'driver';
  const todayStr = new Date().toISOString().split('T')[0];
  const [subTab, setSubTab] = useState<'consolidated' | 'detailed'>('consolidated');
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
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
      const data = await fetchDailyReport(selectedDate, effectiveDriverId);
      setReportData(data);
    } catch (err: any) {
      console.error('Failed to load report', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [selectedDate, effectiveDriverId]);

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
    if (filteredDeliveries.length === 0) {
      alert('Dışa aktarılacak teslimat verisi bulunmuyor');
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
    ];

    const rows = filteredDeliveries.map((del) => {
      const timeStr = new Date(del.timestamp).toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const itemsStr = del.deliveredItems
        .map((i) => `${i.quantity} ${i.productName} (${i.unitPrice} TL)`)
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
        del.deliveredGrandTotal,
        del.collectedPayment.cashAmount,
        del.collectedPayment.posAmount,
        del.collectedPayment.totalCollected,
        del.collectedPayment.diffUncollected,
        del.emptyContainersReceived.damacana || 0,
        Number(del.emptyContainersReceived.camDamacana || del.emptyContainersReceived.cam_damacana) || 0,
        del.emptyContainersReceived.tup || 0,
        `"${(del.notes || '').replace(/"/g, '""')}"`,
      ].join(';');
    });

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
    driverUncollected += Number(d.collectedPayment?.diffUncollected) || 0;
    driverEmptyDamacana += Number(d.emptyContainersReceived?.damacana) || 0;
    driverEmptyCamDamacana += Number(d.emptyContainersReceived?.camDamacana || d.emptyContainersReceived?.cam_damacana) || 0;
    driverEmptyTup += Number(d.emptyContainersReceived?.tup) || 0;
  });

  const driverTotalCollected = driverCashCollected + driverPosCollected;

  // If logged in as driver, display only the simplified End-of-Day Collection Summary
  if (isDriver) {
    return (
      <div className="space-y-6 w-full max-w-full min-w-0">
        {/* Driver Summary Header */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-sky-600 text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-sm">
                <Wallet className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  Şoför Gün Sonu Tahsilat Özeti
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Şoför: <strong>{currentUser?.name}</strong> · Plaka: <strong>{currentUser?.assignedPlate || 'Araç'}</strong>
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative w-full sm:w-auto">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full sm:w-auto pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none"
              />
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <button
              onClick={loadReport}
              disabled={loading}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 text-xs font-semibold shrink-0"
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
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-1">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>Nakit Tahsilat</span>
              <Wallet className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
              {driverCashCollected.toLocaleString('tr-TR')} ₺
            </div>
            <p className="text-[11px] text-slate-400">Elden alınan nakit kasa</p>
          </div>

          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-1">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>POS / Banka Kartı</span>
              <CreditCard className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="text-2xl font-black font-mono text-indigo-600 dark:text-indigo-400 tabular-nums">
              {driverPosCollected.toLocaleString('tr-TR')} ₺
            </div>
            <p className="text-[11px] text-slate-400">Banka slip toplamı</p>
          </div>

          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-1">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>Toplanan Boş Damacana</span>
              <Droplet className="w-4 h-4 text-sky-600" />
            </div>
            <div className="text-2xl font-black font-mono text-slate-900 dark:text-white tabular-nums">
              {driverEmptyDamacana} Adet
            </div>
            <p className="text-[11px] text-slate-400">Depoya teslim edilecek boşlar</p>
          </div>

          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-1">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>Toplanan Boş Cam Damacana</span>
              <RotateCcw className="w-4 h-4 text-amber-600" />
            </div>
            <div className="text-2xl font-black font-mono text-slate-900 dark:text-white tabular-nums">
              {driverEmptyCamDamacana} Adet
            </div>
            <p className="text-[11px] text-slate-400">Depoya teslim edilecek boş cam damacanalar</p>
          </div>

          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-1">
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
              <span>Toplanan Boş Tüp</span>
              <RotateCcw className="w-4 h-4 text-amber-600" />
            </div>
            <div className="text-2xl font-black font-mono text-slate-900 dark:text-white tabular-nums">
              {driverEmptyTup} Adet
            </div>
            <p className="text-[11px] text-slate-400">Depoya teslim edilecek tüpler</p>
          </div>
        </div>

        {/* Clear informative note distinguishing collections from uncollected deliveries */}
        <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 text-xs text-slate-600 dark:text-slate-300 space-y-1">
          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
            <span>ℹ️ Tahsilat Hesaplama Bilgisi</span>
          </div>
          <p>
            Yukarıdaki toplam yalnızca müşterilerden fiilen teslim alınan (elden alınan nakit para ve POS slipleri) tutarları gösterir. Veresiye bırakılan bakiye ({driverUncollected.toLocaleString('tr-TR')} ₺) tahsilat toplamına dahil edilmemiştir.
          </p>
        </div>
      </div>
    );
  }

  const driversList = users.filter((u) => u.role === 'driver');

  return (
    <div className="space-y-6 w-full max-w-full min-w-0">
      {/* Sub-tab Navigation */}
      <div className="print:hidden flex items-center gap-2 p-1.5 bg-slate-100 dark:bg-slate-800/80 rounded-2xl w-fit max-w-full overflow-x-auto">
        <button
          onClick={() => setSubTab('consolidated')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
            subTab === 'consolidated'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Konsolide Gün Sonu Raporu (A4 / PDF Baskı)</span>
        </button>
        <button
          onClick={() => setSubTab('detailed')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
            subTab === 'detailed'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Detaylı Teslimat Listesi & Excel</span>
        </button>
      </div>

      {subTab === 'consolidated' ? (
        <ConsolidatedDailyReport users={users} products={products} />
      ) : (
        <>
          {/* Top Controls Filter Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
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
              onChange={(e) => setSelectedDate(e.target.value)}
              className="pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none"
            />
            <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Driver Selector */}
          <div className="relative">
            <select
              value={selectedDriverId}
              onChange={(e) => setSelectedDriverId(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">Tüm Şoförler ({driversList.length})</option>
              {driversList.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.assignedPlate || 'Araçsız'})
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
            className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 font-semibold text-xs flex items-center gap-1.5 shadow-xs whitespace-nowrap"
          >
            <Printer className="w-4 h-4 text-slate-500" />
            <span>PDF Yazdır</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Toplam Teslimat
          </span>
          <div className="text-xl font-extrabold font-mono text-slate-900 dark:text-white mt-1 tabular-nums">
            {summary.totalDeliveries} Adet
          </div>
          <span className="text-[10px] text-slate-400">{summary.totalCustomersVisited} Farklı Müşteri</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Toplam Ciro (Mal)
          </span>
          <div className="text-xl font-extrabold font-mono text-slate-900 dark:text-white mt-1 tabular-nums">
            {summary.totalDeliveredValue.toLocaleString('tr-TR')} ₺
          </div>
          <span className="text-[10px] text-slate-400">Brüt Teslimat Tutarı</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/20 shadow-xs">
          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block">
            Fiili Nakit Kasa
          </span>
          <div className="text-xl font-extrabold font-mono text-emerald-600 mt-1 tabular-nums">
            {summary.totalCashCollected.toLocaleString('tr-TR')} ₺
          </div>
          <span className="text-[10px] text-emerald-600/80 font-medium">Teslim Edilecek Nakit</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/20 shadow-xs">
          <span className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider block">
            POS Kart Slip Toplamı
          </span>
          <div className="text-xl font-extrabold font-mono text-indigo-600 mt-1 tabular-nums">
            {summary.totalPosCollected.toLocaleString('tr-TR')} ₺
          </div>
          <span className="text-[10px] text-indigo-600/80 font-medium">Banka POS Çekimleri</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/20 shadow-xs">
          <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider block">
            Cari / Veresiye
          </span>
          <div className="text-xl font-extrabold font-mono text-amber-600 mt-1 tabular-nums">
            {summary.totalCreditAdded.toLocaleString('tr-TR')} ₺
          </div>
          <span className="text-[10px] text-amber-600/80 font-medium">Müşteri Borcuna Yazılan</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-orange-200 dark:border-orange-900 bg-orange-50/20 shadow-xs">
          <span className="text-[11px] font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-wider block">
            Toplanan Boş Damacana
          </span>
          <div className="text-xl font-extrabold font-mono text-orange-600 mt-1 tabular-nums">
            {summary.totalEmptyDamacanaCollected} Adet
          </div>
          <span className="text-[10px] text-orange-600/80 font-medium">Depoya İnecek Boş</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/20 shadow-xs">
          <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider block">
            Toplanan Boş Cam Damacana
          </span>
          <div className="text-xl font-extrabold font-mono text-amber-600 mt-1 tabular-nums">
            {summary.totalEmptyCamDamacanaCollected} Adet
          </div>
          <span className="text-[10px] text-amber-600/80 font-medium">Depoya İnecek Boş Cam</span>
        </div>
      </div>

      {/* Deliveries Data Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3 sm:p-5 shadow-xs space-y-4 w-full max-w-full min-w-0 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
            Müşteri Bazlı Teslim Edilen Ürün & Tahsilat Dökümü ({filteredDeliveries.length} Kayıt)
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Tabloda müşteri veya şoför ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800"
            />
          </div>
        </div>

        {filteredDeliveries.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            Seçilen tarih ve kriterlere uygun teslimat kaydı bulunamadı.
          </div>
        ) : (
          <div className="overflow-x-auto w-full max-w-full">
            <table className="w-full text-left text-xs border-collapse min-w-[700px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold bg-slate-50/50 dark:bg-slate-800/50">
                  <th className="py-2.5 px-3">Saat</th>
                  <th className="py-2.5 px-3">Şoför / Plaka</th>
                  <th className="py-2.5 px-3">Müşteri & Adres</th>
                  <th className="py-2.5 px-3">Teslim Edilen Ürünler (Birim Fiyat)</th>
                  <th className="py-2.5 px-3 text-center">Boş Kap</th>
                  <th className="py-2.5 px-3 text-right">Mal Tutarı</th>
                  <th className="py-2.5 px-3 text-right">Nakit</th>
                  <th className="py-2.5 px-3 text-right">POS Kart</th>
                  <th className="py-2.5 px-3 text-right">Cari Borç</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredDeliveries.map((del) => {
                  const timeStr = new Date(del.timestamp).toLocaleTimeString('tr-TR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <tr key={del.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                      <td className="py-3 px-3 font-mono text-slate-500 whitespace-nowrap">
                        {timeStr}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {del.driverName}
                        </div>
                        <div className="font-mono text-[10px] text-slate-400">
                          {del.vehiclePlate}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-900 dark:text-white">
                          {del.customerName}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate max-w-xs">
                          {del.customerAddress}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex flex-wrap gap-1">
                          {del.deliveredItems.map((item, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px]"
                            >
                              <strong>{item.quantity}</strong> {item.productName}{' '}
                              <span className="text-slate-500">({item.unitPrice} ₺)</span>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        {del.emptyContainersReceived.damacana > 0 ||
                        (del.emptyContainersReceived.camDamacana || 0) > 0 ||
                        del.emptyContainersReceived.tup > 0 ? (
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
                            {del.emptyContainersReceived.tup > 0 && (
                              <span className="font-mono font-bold text-slate-600">
                                {del.emptyContainersReceived.tup} Boş Tüp
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                        {del.deliveredGrandTotal.toLocaleString('tr-TR')} ₺
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
                        {del.collectedPayment.diffUncollected > 0 ? (
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
        )}
      </div>
        </>
      )}
    </div>
  );
};

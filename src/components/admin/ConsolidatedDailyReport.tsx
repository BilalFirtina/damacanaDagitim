import React, { useState, useEffect } from 'react';
import { User, Product, Delivery, Dispatch } from '../../types';
import { fetchDailyReport } from '../../services/api';
import { Printer, Calendar, RefreshCw, FileText } from 'lucide-react';

interface ConsolidatedDailyReportProps {
  users: User[];
  products: Product[];
}

export const ConsolidatedDailyReport: React.FC<ConsolidatedDailyReportProps> = ({
  users,
  products,
}) => {
  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [loading, setLoading] = useState<boolean>(false);
  const [reportData, setReportData] = useState<any>(null);

  const loadReport = async () => {
    try {
      setLoading(true);
      const data = await fetchDailyReport(selectedDate, 'all');
      setReportData(data);
    } catch (err: any) {
      console.error('Failed to load consolidated report', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [selectedDate]);

  const handlePrint = () => {
    window.print();
  };

  const dispatches: Dispatch[] = reportData?.dispatches || [];
  const deliveries: Delivery[] = reportData?.deliveries || [];
  const drivers = users.filter((u) => u.role === 'driver');

  // Identify all drivers who performed deliveries or had dispatches on this date
  const activeDriverIds = new Set([
    ...dispatches.map((d) => d.driverId),
    ...deliveries.map((del) => del.driverId),
  ]);

  const activeDriversList = drivers.filter((d) => activeDriverIds.has(d.id));

  // If there are deliveries by drivers not in activeDriversList (e.g. edge cases), include them
  activeDriverIds.forEach((id) => {
    if (!activeDriversList.some((d) => d.id === id)) {
      const matchUser = users.find((u) => u.id === id);
      if (matchUser) {
        activeDriversList.push(matchUser);
      } else {
        const anyDel = deliveries.find((del) => del.driverId === id);
        activeDriversList.push({
          id,
          name: anyDel?.driverName || 'Bilinmeyen Şoför',
          username: id,
          role: 'driver',
          canLoadVehicle: false,
          pin: '',
        });
      }
    }
  });

  // Calculate day grand totals
  let grandDeliveriesCount = deliveries.length;
  let grandTotalValue = 0;
  let grandCashCollected = 0;
  let grandPosCollected = 0;
  let grandCreditAdded = 0;
  let grandDamacanaEmpty = 0;
  let grandCamDamacanaEmpty = 0;
  let grandTupEmpty = 0;

  const grandProductQuantities: Record<string, { name: string; quantity: number; unit: string }> = {};

  deliveries.forEach((del) => {
    grandTotalValue += del.deliveredGrandTotal;
    grandCashCollected += del.collectedPayment.cashAmount;
    grandPosCollected += del.collectedPayment.posAmount;
    if (del.collectedPayment.diffUncollected > 0) {
      grandCreditAdded += del.collectedPayment.diffUncollected;
    }
    grandDamacanaEmpty += del.emptyContainersReceived.damacana || 0;
    grandCamDamacanaEmpty += Number(del.emptyContainersReceived.camDamacana || del.emptyContainersReceived.cam_damacana) || 0;
    grandTupEmpty += del.emptyContainersReceived.tup || 0;

    del.deliveredItems.forEach((item) => {
      if (!grandProductQuantities[item.productId]) {
        const prod = products.find((p) => p.id === item.productId);
        grandProductQuantities[item.productId] = {
          name: item.productName || prod?.name || item.productId,
          quantity: 0,
          unit: prod?.unit || 'Adet',
        };
      }
      grandProductQuantities[item.productId].quantity += item.quantity;
    });
  });

  const formattedDate = new Date(selectedDate + 'T00:00:00').toLocaleDateString(
    'tr-TR',
    {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      weekday: 'long',
    }
  );

  return (
    <div className="space-y-6 w-full max-w-full min-w-0">
      {/* On-Screen Action Controls Bar (Hidden during Print) */}
      <div className="print:hidden bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-slate-700 dark:text-slate-200" />
            <span>Depo Yöneticisi Konsolide Gün Sonu Raporu</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Tüm şoförlerin teslimatları, müşteri bazında döküm, tahsilatlar ve resmi A4 siyah-beyaz baskı / PDF çıktısı
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          {/* Date Picker */}
          <div className="relative">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="pl-8 pr-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none"
            />
            <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Refresh Button */}
          <button
            onClick={loadReport}
            disabled={loading}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
            title="Raporu Yenile"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* Print / PDF Button */}
          <button
            onClick={handlePrint}
            className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-black text-white font-bold text-xs flex items-center gap-2 shadow-sm transition-all active:scale-95"
          >
            <Printer className="w-4 h-4" />
            <span>Yazdır / PDF Olarak Kaydet</span>
          </button>
        </div>
      </div>

      {/* Printable Black-and-White A4 Document Container */}
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

        {/* 1. Official Report Header */}
        <div className="border-b-2 border-black pb-4 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <div className="text-xl sm:text-2xl font-black uppercase tracking-wider text-black">
                SU & TÜP DAĞITIM İŞLETMESİ
              </div>
              <div className="text-sm font-bold uppercase tracking-tight text-black mt-0.5">
                DEPO YÖNETİCİSİ GÜN SONU KONSOLİDE DAĞITIM VE TAHSİLAT RAPORU
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

        {/* 2. Executive Grand Totals Summary (Siyah-Beyaz İcmal Tablosu) */}
        <div className="mb-6 print-avoid-break">
          <div className="text-xs font-black uppercase tracking-wider mb-2 border-b border-black pb-1">
            I. GÜNLÜK GENEL İCMAL VE KASA TOPLAMLARI
          </div>
          <table className="w-full text-xs border border-black border-collapse">
            <tbody>
              <tr className="border-b border-black">
                <td className="p-2 font-bold bg-white border-r border-black w-1/4">Toplam Dağıtım Şoförü:</td>
                <td className="p-2 font-mono font-bold w-1/4 tabular-nums">{activeDriversList.length} Şoför</td>
                <td className="p-2 font-bold bg-white border-r border-l border-black w-1/4">Toplam Teslimat Sayısı:</td>
                <td className="p-2 font-mono font-bold w-1/4 tabular-nums">{grandDeliveriesCount} Müşteri</td>
              </tr>
              <tr className="border-b border-black">
                <td className="p-2 font-bold bg-white border-r border-black">Toplam Brüt Mal Bedeli (Ciro):</td>
                <td className="p-2 font-mono font-black text-sm tabular-nums">{grandTotalValue.toLocaleString('tr-TR')} ₺</td>
                <td className="p-2 font-bold bg-white border-r border-l border-black">Toplam Tahsil Edilen:</td>
                <td className="p-2 font-mono font-black text-sm tabular-nums">{(grandCashCollected + grandPosCollected).toLocaleString('tr-TR')} ₺</td>
              </tr>
              <tr className="border-b border-black">
                <td className="p-2 font-bold bg-white border-r border-black">Fiili Nakit Kasa:</td>
                <td className="p-2 font-mono font-bold tabular-nums">{grandCashCollected.toLocaleString('tr-TR')} ₺</td>
                <td className="p-2 font-bold bg-white border-r border-l border-black">Banka POS Slip Toplamı:</td>
                <td className="p-2 font-mono font-bold tabular-nums">{grandPosCollected.toLocaleString('tr-TR')} ₺</td>
              </tr>
              <tr>
                <td className="p-2 font-bold bg-white border-r border-black">Açık Hesap / Cariye Kalan Borç:</td>
                <td className="p-2 font-mono font-bold tabular-nums">{grandCreditAdded.toLocaleString('tr-TR')} ₺</td>
                <td className="p-2 font-bold bg-white border-r border-l border-black">Toplanan Boş Kaplar:</td>
                <td className="p-2 font-mono font-bold tabular-nums">
                  {grandDamacanaEmpty} Damacana / {grandCamDamacanaEmpty} Cam Damacana / {grandTupEmpty} Boş Tüp
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 3. Product-Level Delivered Quantities Summary */}
        <div className="mb-6 print-avoid-break">
          <div className="text-xs font-black uppercase tracking-wider mb-2 border-b border-black pb-1">
            II. GÜN İÇİNDE TESLİM EDİLEN ÜRÜN VE ADET DÖKÜMÜ
          </div>
          <table className="w-full text-xs border border-black border-collapse text-left">
            <thead>
              <tr className="border-b border-black bg-white">
                <th className="p-2 border-r border-black">S.No</th>
                <th className="p-2 border-r border-black">Ürün Tanımı</th>
                <th className="p-2 border-r border-black text-center">Birim</th>
                <th className="p-2 border-r border-black text-right">Toplam Teslim Adedi</th>
                <th className="p-2 text-right">Toplam Tutar</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(grandProductQuantities).length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-3 text-center italic border-b border-black">
                    Seçilen tarihte henüz tamamlanan teslimat kaydı bulunmuyor.
                  </td>
                </tr>
              ) : (
                Object.entries(grandProductQuantities).map(([productId, item], idx) => {
                  const productTotalAmount = deliveries.reduce((acc, del) => {
                    const line = del.deliveredItems.find((i) => i.productId === productId);
                    return acc + (line ? line.lineTotal : 0);
                  }, 0);

                  return (
                    <tr key={productId} className="border-b border-black">
                      <td className="p-2 border-r border-black font-mono">{idx + 1}</td>
                      <td className="p-2 border-r border-black font-bold">{item.name}</td>
                      <td className="p-2 border-r border-black text-center">{item.unit}</td>
                      <td className="p-2 border-r border-black text-right font-mono font-bold tabular-nums">
                        {item.quantity}
                      </td>
                      <td className="p-2 text-right font-mono tabular-nums">
                        {productTotalAmount.toLocaleString('tr-TR')} ₺
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 4. Driver-by-Driver Customer and Collection Details */}
        <div className="space-y-6">
          <div className="text-xs font-black uppercase tracking-wider mb-2 border-b border-black pb-1">
            III. ŞOFÖR BAZINDA DETAYLI DAĞITIM VE EKSİKSİZ MÜŞTERİ LİSTESİ
          </div>

          {activeDriversList.length === 0 ? (
            <div className="p-6 text-center text-xs italic border border-black">
              Bu tarihte sefere çıkan veya teslimat yapan şoför kaydı bulunmuyor.
            </div>
          ) : (
            activeDriversList.map((driver, driverIdx) => {
              const driverDispatches = dispatches.filter((d) => d.driverId === driver.id);
              const driverDeliveries = deliveries.filter((del) => del.driverId === driver.id);

              const plates = Array.from(
                new Set([
                  ...driverDispatches.map((d) => d.vehiclePlate),
                  ...driverDeliveries.map((del) => del.vehiclePlate),
                ])
              ).filter(Boolean);

              const plateStr = plates.join(', ') || driver.assignedPlate || 'Belirtilmedi';

              // Driver Subtotals
              let dSubTotalVal = 0;
              let dCash = 0;
              let dPos = 0;
              let dCredit = 0;
              let dDamacana = 0;
              let dCamDamacana = 0;
              let dTup = 0;

              driverDeliveries.forEach((del) => {
                dSubTotalVal += del.deliveredGrandTotal;
                dCash += del.collectedPayment.cashAmount;
                dPos += del.collectedPayment.posAmount;
                if (del.collectedPayment.diffUncollected > 0) {
                  dCredit += del.collectedPayment.diffUncollected;
                }
                dDamacana += del.emptyContainersReceived.damacana || 0;
                dCamDamacana += Number(del.emptyContainersReceived.camDamacana || del.emptyContainersReceived.cam_damacana) || 0;
                dTup += del.emptyContainersReceived.tup || 0;
              });

              return (
                <div key={driver.id} className="border border-black print-avoid-break mb-6">
                  {/* Driver Header Strip */}
                  <div className="p-3 bg-white border-b border-black flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm">#{driverIdx + 1}</span>
                      <span className="font-black text-sm uppercase">
                        {driver.name}
                      </span>
                      <span className="text-xs font-bold">
                        · Araç Plakası: <span className="font-mono">{plateStr}</span>
                      </span>
                    </div>

                    <div className="text-xs font-medium space-x-2">
                      <span>
                        Sefer Sayısı: <strong>{driverDispatches.length || 1}</strong>
                      </span>
                      <span>·</span>
                      <span>
                        Ziyaret Edilen Müşteri: <strong>{driverDeliveries.length}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Customer Deliveries Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse text-left">
                      <thead>
                        <tr className="border-b border-black bg-white">
                          <th className="p-2 border-r border-black w-8">No</th>
                          <th className="p-2 border-r border-black w-14">Saat</th>
                          <th className="p-2 border-r border-black w-40">Müşteri Adı</th>
                          <th className="p-2 border-r border-black">Teslim Edilen Ürünler & Adetler</th>
                          <th className="p-2 border-r border-black text-right w-20">Tutar</th>
                          <th className="p-2 border-r border-black text-right w-20">Nakit</th>
                          <th className="p-2 border-r border-black text-right w-20">POS</th>
                          <th className="p-2 border-r border-black text-right w-20">Cari Borç</th>
                          <th className="p-2 border-r border-black text-center w-20">Boş Kap</th>
                          <th className="p-2 w-28">Not</th>
                        </tr>
                      </thead>
                      <tbody>
                        {driverDeliveries.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="p-3 text-center italic border-b border-black">
                              Bu şoför için seçilen tarihte kayıtlı teslimat bulunmuyor.
                            </td>
                          </tr>
                        ) : (
                          driverDeliveries.map((del, dIdx) => {
                            const timeStr = new Date(del.timestamp).toLocaleTimeString('tr-TR', {
                              hour: '2-digit',
                              minute: '2-digit',
                            });

                            const itemsListStr = del.deliveredItems
                              .map((i) => `${i.quantity} ${i.productName}`)
                              .join(', ');

                            const emptyListStr = [
                              del.emptyContainersReceived.damacana > 0
                                ? `${del.emptyContainersReceived.damacana} Boş D.`
                                : null,
                              Number(del.emptyContainersReceived.camDamacana || 0) > 0
                                ? `${del.emptyContainersReceived.camDamacana} Boş Cam D.`
                                : null,
                              del.emptyContainersReceived.tup > 0
                                ? `${del.emptyContainersReceived.tup} Boş T.`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(', ') || '-';

                            return (
                              <tr key={del.id} className="border-b border-black">
                                <td className="p-2 border-r border-black font-mono">{dIdx + 1}</td>
                                <td className="p-2 border-r border-black font-mono">{timeStr}</td>
                                <td className="p-2 border-r border-black font-bold break-words">
                                  {del.customerName}
                                  {del.customerAddress && (
                                    <div className="text-[10px] font-normal text-black mt-0.5">
                                      {del.customerAddress}
                                    </div>
                                  )}
                                </td>
                                <td className="p-2 border-r border-black font-medium">
                                  {itemsListStr}
                                </td>
                                <td className="p-2 border-r border-black text-right font-mono font-bold tabular-nums">
                                  {del.deliveredGrandTotal.toLocaleString('tr-TR')} ₺
                                </td>
                                <td className="p-2 border-r border-black text-right font-mono tabular-nums">
                                  {del.collectedPayment.cashAmount > 0
                                    ? `${del.collectedPayment.cashAmount.toLocaleString('tr-TR')} ₺`
                                    : '-'}
                                </td>
                                <td className="p-2 border-r border-black text-right font-mono tabular-nums">
                                  {del.collectedPayment.posAmount > 0
                                    ? `${del.collectedPayment.posAmount.toLocaleString('tr-TR')} ₺`
                                    : '-'}
                                </td>
                                <td className="p-2 border-r border-black text-right font-mono tabular-nums">
                                  {del.collectedPayment.diffUncollected > 0
                                    ? `${del.collectedPayment.diffUncollected.toLocaleString('tr-TR')} ₺`
                                    : '-'}
                                </td>
                                <td className="p-2 border-r border-black text-center font-mono">
                                  {emptyListStr}
                                </td>
                                <td className="p-2 text-[10px] break-words">
                                  {del.notes || '-'}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                      {/* Driver Subtotals Footer */}
                      <tfoot>
                        <tr className="bg-white font-bold border-t-2 border-black">
                          <td colSpan={4} className="p-2 text-right border-r border-black uppercase">
                            {driver.name} Ara Toplamı ({driverDeliveries.length} Teslimat):
                          </td>
                          <td className="p-2 text-right font-mono border-r border-black tabular-nums">
                            {dSubTotalVal.toLocaleString('tr-TR')} ₺
                          </td>
                          <td className="p-2 text-right font-mono border-r border-black tabular-nums">
                            {dCash.toLocaleString('tr-TR')} ₺
                          </td>
                          <td className="p-2 text-right font-mono border-r border-black tabular-nums">
                            {dPos.toLocaleString('tr-TR')} ₺
                          </td>
                          <td className="p-2 text-right font-mono border-r border-black tabular-nums">
                            {dCredit.toLocaleString('tr-TR')} ₺
                          </td>
                          <td className="p-2 text-center font-mono border-r border-black tabular-nums">
                            {dDamacana} D. / {dCamDamacana} Cam D. / {dTup} T.
                          </td>
                          <td className="p-2"></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 5. Official Verification & Signature Section */}
        <div className="mt-8 pt-4 border-t-2 border-black print-avoid-break">
          <div className="text-xs font-black uppercase tracking-wider mb-4">
            IV. RESMİ TESLİM VE ONAY İMZALARI
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 text-xs">
            {/* Depo Yöneticisi */}
            <div className="border border-black p-4 space-y-8">
              <div className="space-y-1">
                <div className="font-bold uppercase">KONTROL VE ONAY: DEPO YÖNETİCİSİ</div>
                <div>Yukarıda dökümü yapılan günlük teslimatlar, kasa nakitleri, banka slipleri ve boş kaplar sayılmış olup mutabakat sağlanarak teslim alınmıştır.</div>
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

            {/* Teslim Eden Şoförler */}
            <div className="border border-black p-4 space-y-8">
              <div className="space-y-1">
                <div className="font-bold uppercase">TESLİM EDEN: DAĞITIM ŞOFÖRLERİ</div>
                <div>Aracımdaki kalan dolu ürünleri depoya boşalttığımı, topladığım boş kapları ve tahsilat tutarlarını eksiksiz teslim ettiğimi beyan ederim.</div>
              </div>
              <div className="flex justify-between items-end pt-4 border-t border-black">
                <div>
                  <div><strong>Şoförler:</strong> {activeDriversList.map((d) => d.name).join(', ') || 'Şoför'}</div>
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

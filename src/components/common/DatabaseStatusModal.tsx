import React, { useState, useEffect } from 'react';
import { Database, CheckCircle2, AlertCircle, RefreshCw, Copy, Check, ExternalLink, HardDrive, Server, ShieldCheck } from 'lucide-react';
import { DatabaseStatus } from '../../types';
import { fetchDatabaseStatus, triggerDatabaseSeed } from '../../services/api';

interface DatabaseStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DatabaseStatusModal: React.FC<DatabaseStatusModalProps> = ({ isOpen, onClose }) => {
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [activeTab, setActiveTab] = useState<'status' | 'guide'>('status');

  const loadStatus = async () => {
    try {
      setIsLoading(true);
      const data = await fetchDatabaseStatus();
      setStatus(data);
    } catch (err) {
      console.error('Failed to load database status', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadStatus();
    }
  }, [isOpen]);

  const handleSeed = async () => {
    try {
      setIsSeeding(true);
      await triggerDatabaseSeed();
      await loadStatus();
    } catch (err: any) {
      alert('Başlangıç verileri aktarılırken hata: ' + err.message);
    } finally {
      setIsSeeding(false);
    }
  };

  const handleCopySql = async () => {
    try {
      const res = await fetch('/supabase_schema.sql');
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      // Fallback
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2500);
    }
  };

  if (!isOpen) return null;

  const isSupabase = status?.type === 'supabase_api' || status?.type === 'postgres_direct';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/40">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-md ${
              isSupabase ? 'bg-emerald-600 shadow-emerald-500/20' : 'bg-amber-600 shadow-amber-500/20'
            }`}>
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>Veritabanı & Supabase Durumu</span>
                {status?.isConnected ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Aktif
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400">
                    Yerel Mod
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                PostgreSQL tabloları, canlı veri senkronizasyonu ve bulut entegrasyonu
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 px-5 bg-white dark:bg-slate-900">
          <button
            onClick={() => setActiveTab('status')}
            className={`py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'status'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            Bağlantı ve Tablo İstatistikleri
          </button>
          <button
            onClick={() => setActiveTab('guide')}
            className={`py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'guide'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            Supabase Kurulum Rehberi (3 Adım)
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-sm">
          {activeTab === 'status' ? (
            <>
              {/* Connection Status Card */}
              <div className={`p-4 rounded-xl border ${
                status?.isConnected
                  ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60'
                  : 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/60'
              }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {status?.isConnected ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <HardDrive className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white text-sm">
                        {status?.provider || 'Yükleniyor...'}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                        {status?.message}
                      </div>
                      {status?.url && (
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1">
                          Hedef: {status.url}
                        </div>
                      )}
                      {status?.error && (
                        <div className="text-xs text-red-600 dark:text-red-400 mt-2 font-medium bg-red-50 dark:bg-red-950/40 p-2 rounded-lg border border-red-200 dark:border-red-900">
                          Hata Detayı: {status.error}
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={loadStatus}
                    disabled={isLoading}
                    className="p-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-white dark:hover:bg-slate-800 transition-colors shrink-0"
                    title="Yenile"
                  >
                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-sky-600' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Table Records Grid */}
              <div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                  PostgreSQL Tablo Kayıt Sayıları
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">👥 Kullanıcılar (users)</span>
                    <span className="text-xl font-bold text-slate-900 dark:text-white">
                      {status?.tables.users ?? 0}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">💧 Ürün Kataloğu (products)</span>
                    <span className="text-xl font-bold text-slate-900 dark:text-white">
                      {status?.tables.products ?? 0}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">🏪 Müşteriler (customers)</span>
                    <span className="text-xl font-bold text-slate-900 dark:text-white">
                      {status?.tables.customers ?? 0}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">🚛 Araç Seferleri (dispatches)</span>
                    <span className="text-xl font-bold text-slate-900 dark:text-white">
                      {status?.tables.dispatches ?? 0}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800 col-span-2 sm:col-span-1">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">📦 Saha Teslimatları (deliveries)</span>
                    <span className="text-xl font-bold text-slate-900 dark:text-white">
                      {status?.tables.deliveries ?? 0}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <button
                  onClick={handleCopySql}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSql ? 'SQL Şeması Kopyalandı!' : 'supabase_schema.sql Kopyala'}</span>
                </button>

                {isSupabase && (
                  <button
                    onClick={handleSeed}
                    disabled={isSeeding}
                    className="px-3.5 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSeeding ? 'animate-spin' : ''}`} />
                    <span>{isSeeding ? 'Aktarılıyor...' : 'Başlangıç Verilerini Supabase\'e Aktar'}</span>
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="p-3.5 bg-sky-50 dark:bg-sky-950/40 rounded-xl border border-sky-200 dark:border-sky-800 text-xs text-sky-800 dark:text-sky-300">
                <strong>💡 Bilgi:</strong> Projeyi GitHub'a pushladıktan sonra Render.com veya Railway.app üzerinde Supabase PostgreSQL veritabanınızı bağlamak için aşağıdaki 3 adımı yapmanız yeterlidir:
              </div>

              {/* Step 1 */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="font-bold text-slate-900 dark:text-white text-xs mb-1">
                  1. Adım: Supabase'de Ücretsiz Proje Açın
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                  <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="text-sky-600 font-semibold underline inline-flex items-center gap-0.5">
                    supabase.com <ExternalLink className="w-3 h-3 ml-0.5" />
                  </a> adresinden ücretsiz bir proje oluşturun.
                </p>
              </div>

              {/* Step 2 */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="font-bold text-slate-900 dark:text-white text-xs mb-1">
                  2. Adım: SQL Editor'de Tabloları Oluşturun (Tek Tıkla)
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                  Supabase sol menüsünden <strong>"SQL Editor"</strong> sekmesini açın. Aşağıdaki butona basarak şemayı kopyalayın ve yeşil <strong>"Run"</strong> butonuna basın:
                </p>
                <button
                  onClick={handleCopySql}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSql ? 'Kopyalandı!' : 'SQL Kodunu Panoya Kopyala'}</span>
                </button>
              </div>

              {/* Step 3 */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="font-bold text-slate-900 dark:text-white text-xs mb-1">
                  3. Adım: Render veya Railway Ortam Değişkenlerine Ekleyin
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                  Supabase <strong>Project Settings → API</strong> sekmesindeki iki bilgiyi Render / Railway'deki Environment Variables bölümüne ekleyin:
                </p>
                <div className="bg-slate-900 text-slate-100 p-2.5 rounded-lg font-mono text-[11px] space-y-1">
                  <div>SUPABASE_URL=https://projeniz.supabase.co</div>
                  <div>SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1Ni...</div>
                </div>
                <p className="text-[11px] text-slate-500 mt-2">
                  Alternatif olarak doğrudan <code>DATABASE_URL=postgresql://...</code> dizesi de desteklenir.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-semibold transition-colors"
          >
            Kapat
          </button>
        </div>

      </div>
    </div>
  );
};

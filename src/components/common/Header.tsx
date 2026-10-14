import React, { useState } from 'react';
import { User } from '../../types';
import { PWAInstallButton } from './PWAInstallButton';
import { DatabaseStatusModal } from './DatabaseStatusModal';
import { Truck, ShieldCheck, UserCheck, RefreshCw, Layers, LogOut, Database } from 'lucide-react';

interface HeaderProps {
  currentUser: User;
  allUsers: User[];
  onSwitchUser: (user: User) => void;
  onLogout: () => void;
  activeTab: 'delivery' | 'team_feed' | 'eod' | 'customers' | 'products' | 'admin_loads' | 'reports' | 'retention';
  setActiveTab: (tab: any) => void;
  onRefreshData: () => void;
  isRefreshing?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  allUsers,
  onSwitchUser,
  onLogout,
  activeTab,
  setActiveTab,
  onRefreshData,
  isRefreshing,
}) => {
  const [isDbModalOpen, setIsDbModalOpen] = useState(false);
  const isAdmin = currentUser.role === 'admin';

  return (
    <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-xs w-full max-w-full overflow-hidden">
      <div className="max-w-7xl mx-auto px-2.5 sm:px-6 flex items-center justify-between gap-1.5 sm:gap-4 md:gap-8 h-14 sm:h-16 w-full max-w-full">
        
        {/* Zone 1: Brand Wordmark (Single text element wordmark + icon) */}
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-tr from-sky-600 to-sky-400 flex items-center justify-center text-white shadow-md shadow-sky-500/20 shrink-0">
            <Truck className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <div className="min-w-0">
            <span className="text-sm sm:text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
              Dağıtım <span className="text-sky-600 font-extrabold ml-0.5">& Mutabakat</span>
            </span>
          </div>
        </div>

        {/* Zone 2: Navigation Links (Clean single-line text tabs) */}
        <nav className="hidden lg:flex items-center gap-1 overflow-x-auto py-1">
          <button
            onClick={() => setActiveTab('delivery')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'delivery'
                ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Saha Dağıtımı
          </button>

          <button
            onClick={() => setActiveTab('team_feed')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              activeTab === 'team_feed'
                ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <span>Ekip Canlı Akışı</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </button>

          <button
            onClick={() => setActiveTab('eod')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'eod'
                ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Gün Sonu Kapatma
          </button>

          <button
            onClick={() => setActiveTab('customers')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'customers'
                ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Müşteriler & Borçlar
          </button>

          <button
            onClick={() => setActiveTab('products')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'products'
                ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Ürünler & Fiyatlar
          </button>

          <button
            onClick={() => setActiveTab('reports')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'reports'
                ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Gün Sonu Dökümü (PDF/Excel)
          </button>

          {isAdmin && (
            <>
              <button
                onClick={() => setActiveTab('admin_loads')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'admin_loads'
                    ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                Araç Yüklemeleri & Yetki
              </button>

              <button
                onClick={() => setActiveTab('retention')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'retention'
                    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                60 Günlük Temizlik
              </button>
            </>
          )}
        </nav>

        {/* Zone 3: Active User & Role Switcher + PWA Button */}
        <div className="flex items-center gap-1 sm:gap-2.5 shrink-0">
          <PWAInstallButton />

          <button
            onClick={() => setIsDbModalOpen(true)}
            className="p-1.5 text-slate-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1 shrink-0"
            title="Veritabanı & Supabase Durumu"
          >
            <Database className="w-4 h-4 shrink-0" />
            <span className="hidden md:inline text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              Supabase
            </span>
          </button>

          <button
            onClick={onRefreshData}
            disabled={isRefreshing}
            className="p-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            title="Verileri Yenile"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-sky-600' : ''}`} />
          </button>

          {/* Active User Badge */}
          <div
            className="flex items-center gap-1.5 py-1 px-1.5 sm:px-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/80 shrink-0"
            title={`${currentUser.name} (${currentUser.title || (currentUser.role === 'admin' ? 'Depo Yöneticisi' : 'Şoför')})`}
          >
            <div className="w-6 h-6 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 flex items-center justify-center text-xs font-bold shrink-0">
              {currentUser.name.charAt(0)}
            </div>
            <div className="hidden md:flex flex-col text-left">
              <span className="text-xs font-bold text-slate-900 dark:text-white leading-tight truncate max-w-[110px] sm:max-w-[140px]">
                {currentUser.name.split(' ')[0]}
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-none truncate max-w-[150px]">
                {currentUser.title
                  ? currentUser.title
                  : currentUser.role === 'admin'
                  ? 'Depo Yöneticisi'
                  : currentUser.canLoadVehicle
                  ? 'Yetkili Şoför'
                  : 'Saha Dağıtım Şoförü'}
                {currentUser.role !== 'admin' && currentUser.assignedPlate ? ` · ${currentUser.assignedPlate}` : ''}
              </span>
            </div>
          </div>

          {/* Explicit Logout Button */}
          <button
            onClick={onLogout}
            className="flex items-center gap-1 p-1.5 sm:px-2.5 sm:py-1.5 text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl border border-red-200/60 dark:border-red-900/40 transition-colors shrink-0"
            title="Oturumu Kapat (Çıkış Yap)"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Çıkış</span>
          </button>
        </div>
      </div>

      {/* Mobile Secondary Tab Navigation Bar */}
      <div className="lg:hidden w-full max-w-full overflow-x-auto px-2.5 py-1.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 scrollbar-none flex items-center gap-1">
        <button
          onClick={() => setActiveTab('delivery')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
            activeTab === 'delivery'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
          }`}
        >
          Saha Dağıtımı
        </button>

        <button
          onClick={() => setActiveTab('team_feed')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors flex items-center gap-1.5 ${
            activeTab === 'team_feed'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
          }`}
        >
          <span>Ekip Akışı</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </button>

        <button
          onClick={() => setActiveTab('eod')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
            activeTab === 'eod'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
          }`}
        >
          Gün Sonu
        </button>

        <button
          onClick={() => setActiveTab('customers')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
            activeTab === 'customers'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
          }`}
        >
          Müşteriler
        </button>

        <button
          onClick={() => setActiveTab('reports')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
            activeTab === 'reports'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
          }`}
        >
          Raporlar
        </button>

        {isAdmin && (
          <>
            <button
              onClick={() => setActiveTab('admin_loads')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'admin_loads'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
              }`}
            >
              Yüklemeler
            </button>
            <button
              onClick={() => setActiveTab('retention')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'retention'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
              }`}
            >
              60 Gün Temizlik
            </button>
          </>
        )}
      </div>

      <DatabaseStatusModal isOpen={isDbModalOpen} onClose={() => setIsDbModalOpen(false)} />
    </header>
  );
};

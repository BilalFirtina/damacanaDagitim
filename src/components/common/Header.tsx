import React from 'react';
import { User } from '../../types';
import {
  Truck,
  ShieldCheck,
  RefreshCw,
  LogOut,
  Activity,
  CheckCircle2,
  Users,
  Package,
  FileText,
  CalendarCheck,
} from 'lucide-react';

interface HeaderProps {
  currentUser: User;
  onLogout: () => void;
  activeTab: 'delivery' | 'team_feed' | 'eod' | 'customers' | 'products' | 'admin_loads' | 'reports' | 'retention';
  setActiveTab: (tab: any) => void;
  onRefreshData: () => void;
  isRefreshing?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  onLogout,
  activeTab,
  setActiveTab,
  onRefreshData,
  isRefreshing,
}) => {
  const isAdmin = currentUser.role === 'admin';

  return (
    <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-xs w-full max-w-full">
      {/* Top Bar Header */}
      <div className="max-w-7xl mx-auto px-2.5 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 md:gap-8 h-14 sm:h-16 w-full max-w-full">
        {/* Zone 1: Brand Wordmark (Directly displayed, no open/close toggle) */}
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

        {/* Zone 2: Desktop Navigation Links (Unified flat layout with wrapping) */}
        <nav className="hidden lg:flex items-center gap-1.5 flex-wrap py-1">
          <button
            onClick={() => setActiveTab('delivery')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'delivery'
                ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Saha Dağıtımı
          </button>

          <button
            onClick={() => setActiveTab('team_feed')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'team_feed'
                ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <span>Ekip Canlı Akışı</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </button>

          <button
            onClick={() => setActiveTab('eod')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'eod'
                ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Gün Sonu Kapatma
          </button>

          <button
            onClick={() => setActiveTab('customers')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'customers'
                ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Müşteriler & Borçlar
          </button>

          <button
            onClick={() => setActiveTab('products')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'products'
                ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Ürünler & Fiyatlar
          </button>

          <button
            onClick={() => setActiveTab('reports')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'reports'
                ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Gün Sonu Dökümü (PDF/Excel)
          </button>

          {isAdmin && (
            <>
              <button
                onClick={() => setActiveTab('admin_loads')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'admin_loads'
                    ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                Araç Yüklemeleri & Yetki
              </button>

              <button
                onClick={() => setActiveTab('retention')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'retention'
                    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                60 Günlük Temizlik
              </button>
            </>
          )}
        </nav>

        {/* Zone 3: Actions & Explicit Logout Button (Always visible on all screens) */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <button
            onClick={onRefreshData}
            disabled={isRefreshing}
            className="p-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
            title="Verileri Yenile"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-sky-600' : ''}`} />
          </button>

          {/* Active User Badge */}
          <div
            className="flex items-center gap-1.5 py-1 px-1.5 sm:px-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/80 shrink-0"
            title={`${currentUser.name} (${currentUser.title || (currentUser.role === 'admin' ? 'Depo Yöneticisi' : 'Şoför')})`}
          >
            <div className="w-6 h-6 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 flex items-center justify-center text-xs font-bold shrink-0">
              {currentUser.name.charAt(0)}
            </div>
            <div className="hidden sm:flex flex-col text-left">
              <span className="text-xs font-bold text-slate-900 dark:text-white leading-tight truncate max-w-[90px] md:max-w-[130px]">
                {currentUser.name.split(' ')[0]}
              </span>
            </div>
          </div>

          {/* Explicit Always-Visible Logout Button in Top Bar */}
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl border border-red-200 dark:border-red-900/60 transition-colors shrink-0 cursor-pointer"
            title="Oturumu Kapat (Çıkış Yap)"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0 text-red-600" />
            <span className="font-bold">Çıkış Yap</span>
          </button>
        </div>
      </div>

      {/* Mobile Flat Responsive Grid Navigation (Always visible directly, no open/close toggle, multiple columns side by side, wrapping vertically, no horizontal scrolling) */}
      <div className="lg:hidden w-full max-w-full box-border border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/95 dark:bg-slate-900/95 px-2.5 sm:px-4 py-2.5 grid grid-cols-1 min-[360px]:grid-cols-2 gap-2 overflow-x-hidden overflow-y-visible">
        {/* Item 1: Saha Dağıtımı */}
        <button
          type="button"
          onClick={() => setActiveTab('delivery')}
          className={`w-full min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-all text-left cursor-pointer box-border ${
            activeTab === 'delivery'
              ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-500 font-bold'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-700/60'
          }`}
        >
          <Truck className={`w-4 h-4 shrink-0 ${activeTab === 'delivery' ? 'text-white' : 'text-sky-600'}`} />
          <span className="truncate">Saha Dağıtımı</span>
        </button>

        {/* Item 2: Ekip Canlı Akışı */}
        <button
          type="button"
          onClick={() => setActiveTab('team_feed')}
          className={`w-full min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 transition-all text-left cursor-pointer box-border ${
            activeTab === 'team_feed'
              ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-500 font-bold'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-700/60'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Activity
              className={`w-4 h-4 shrink-0 ${activeTab === 'team_feed' ? 'text-white' : 'text-emerald-500'}`}
            />
            <span className="truncate">Ekip Canlı Akışı</span>
          </div>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
        </button>

        {/* Item 3: Gün Sonu Kapatma */}
        <button
          type="button"
          onClick={() => setActiveTab('eod')}
          className={`w-full min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-all text-left cursor-pointer box-border ${
            activeTab === 'eod'
              ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-500 font-bold'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-700/60'
          }`}
        >
          <CheckCircle2
            className={`w-4 h-4 shrink-0 ${activeTab === 'eod' ? 'text-white' : 'text-amber-500'}`}
          />
          <span className="truncate">Gün Sonu Kapatma</span>
        </button>

        {/* Item 4: Müşteriler & Borçlar */}
        <button
          type="button"
          onClick={() => setActiveTab('customers')}
          className={`w-full min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-all text-left cursor-pointer box-border ${
            activeTab === 'customers'
              ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-500 font-bold'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-700/60'
          }`}
        >
          <Users
            className={`w-4 h-4 shrink-0 ${activeTab === 'customers' ? 'text-white' : 'text-indigo-500'}`}
          />
          <span className="truncate">Müşteriler & Borçlar</span>
        </button>

        {/* Item 5: Ürünler & Fiyatlar */}
        <button
          type="button"
          onClick={() => setActiveTab('products')}
          className={`w-full min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-all text-left cursor-pointer box-border ${
            activeTab === 'products'
              ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-500 font-bold'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-700/60'
          }`}
        >
          <Package
            className={`w-4 h-4 shrink-0 ${activeTab === 'products' ? 'text-white' : 'text-violet-500'}`}
          />
          <span className="truncate">Ürünler & Fiyatlar</span>
        </button>

        {/* Item 6: Gün Sonu Dökümü */}
        <button
          type="button"
          onClick={() => setActiveTab('reports')}
          className={`w-full min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-all text-left cursor-pointer box-border ${
            activeTab === 'reports'
              ? 'bg-sky-600 text-white shadow-sm ring-1 ring-sky-500 font-bold'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-700/60'
          }`}
        >
          <FileText
            className={`w-4 h-4 shrink-0 ${activeTab === 'reports' ? 'text-white' : 'text-blue-500'}`}
          />
          <span className="truncate">Gün Sonu Dökümü</span>
        </button>

        {/* Admin Items (flat layout, role-based visibility) */}
        {isAdmin && (
          <>
            <button
              type="button"
              onClick={() => setActiveTab('admin_loads')}
              className={`w-full min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-all text-left cursor-pointer box-border ${
                activeTab === 'admin_loads'
                  ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-500 font-bold'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-700/60'
              }`}
            >
              <ShieldCheck
                className={`w-4 h-4 shrink-0 ${activeTab === 'admin_loads' ? 'text-white' : 'text-indigo-600'}`}
              />
              <span className="truncate">Yüklemeler & Yetki</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('retention')}
              className={`w-full min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-all text-left cursor-pointer box-border ${
                activeTab === 'retention'
                  ? 'bg-amber-600 text-white shadow-sm ring-1 ring-amber-500 font-bold'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-700/60'
              }`}
            >
              <CalendarCheck
                className={`w-4 h-4 shrink-0 ${activeTab === 'retention' ? 'text-white' : 'text-amber-600'}`}
              />
              <span className="truncate">60 Günlük Temizlik</span>
            </button>
          </>
        )}
      </div>
    </header>
  );
};

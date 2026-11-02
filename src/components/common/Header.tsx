import React, { useEffect, useRef, useState } from 'react';
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
  AlertCircle,
} from 'lucide-react';

export function getFirstName(fullName: string, fallback: string): string {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return fallback;
  return trimmed.split(/\s+/)[0];
}

interface HeaderProps {
  currentUser: User;
  onLogout: () => void;
  activeTab: 'delivery' | 'team_feed' | 'eod' | 'customers' | 'products' | 'admin_loads' | 'reports' | 'retention';
  setActiveTab: (tab: any) => void;
  onRefreshData: () => void | Promise<boolean | void>;
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
  const nameFallback = currentUser.title || (currentUser.role === 'admin' ? 'Depo Yöneticisi' : 'Şoför');
  const firstName = getFirstName(currentUser.name, nameFallback);

  const [refreshState, setRefreshState] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  );
  const feedbackTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    },
    []
  );

  const isBusy = refreshState === 'loading' || !!isRefreshing;

  const handleRefresh = async () => {
    if (isBusy) return;
    setRefreshState('loading');
    try {
      const result = await onRefreshData();
      setRefreshState(result === false ? 'error' : 'success');
    } catch {
      setRefreshState('error');
    }
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setRefreshState('idle'), 2500);
  };

  const mobileNavItems: Array<{
    tab: HeaderProps['activeTab'];
    label: string;
    ariaLabel: string;
    icon: React.ComponentType<{ className?: string }>;
    iconClass: string;
    activeClass: string;
    adminOnly?: boolean;
  }> = [
    { tab: 'delivery', label: 'Dağıtım', ariaLabel: 'Saha Dağıtımı', icon: Truck, iconClass: 'text-sky-600', activeClass: 'bg-sky-600' },
    { tab: 'team_feed', label: 'Canlı Akış', ariaLabel: 'Ekip Canlı Akışı', icon: Activity, iconClass: 'text-emerald-500', activeClass: 'bg-sky-600' },
    { tab: 'eod', label: 'Gün Sonu', ariaLabel: 'Gün Sonu Kapatma', icon: CheckCircle2, iconClass: 'text-amber-500', activeClass: 'bg-sky-600' },
    { tab: 'customers', label: 'Müşteriler', ariaLabel: 'Müşteriler & Borçlar', icon: Users, iconClass: 'text-indigo-500', activeClass: 'bg-sky-600' },
    { tab: 'products', label: 'Ürünler', ariaLabel: 'Ürünler & Fiyatlar', icon: Package, iconClass: 'text-violet-500', activeClass: 'bg-sky-600' },
    { tab: 'reports', label: 'Raporlar', ariaLabel: 'Gün Sonu Dökümü (PDF/Excel)', icon: FileText, iconClass: 'text-blue-500', activeClass: 'bg-sky-600' },
    { tab: 'admin_loads', label: 'Yükleme', ariaLabel: 'Araç Yüklemeleri & Yetki', icon: ShieldCheck, iconClass: 'text-indigo-600', activeClass: 'bg-indigo-600', adminOnly: true },
    { tab: 'retention', label: 'Temizlik', ariaLabel: '60 Günlük Temizlik', icon: CalendarCheck, iconClass: 'text-amber-600', activeClass: 'bg-amber-600', adminOnly: true },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-xs w-full max-w-full">
      {/* Top Bar Header */}
      <div className="w-full px-2.5 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 md:gap-8 h-14 sm:h-16 max-w-full">
        {/* Zone 1: Brand Wordmark (Directly displayed, no open/close toggle) */}
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          <img
            src="/logo-header.png"
            alt=""
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-white ring-1 ring-slate-200 dark:ring-slate-700 object-contain shrink-0"
          />
          <div className="min-w-0">
            <span className="text-[13px] min-[360px]:text-sm sm:text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
              Fırtına<span className="text-sky-600 font-extrabold ml-0.5">Gıda</span>
            </span>
          </div>
        </div>

        {/* Zone 3: Actions & Explicit Logout Button (Always visible on all screens) */}
        <div className="flex items-center gap-1 sm:gap-2 min-w-0 lg:shrink-0">
          <button
            onClick={handleRefresh}
            disabled={isBusy}
            className="flex items-center justify-center min-w-11 min-h-11 sm:min-w-0 sm:min-h-0 p-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            title="Verileri Yenile"
            aria-label="Verileri Yenile"
          >
            {refreshState === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : refreshState === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-600" />
            ) : (
              <RefreshCw className={`w-4 h-4 ${isBusy ? 'animate-spin text-sky-600' : ''}`} />
            )}
          </button>

          {/* Active User Badge */}
          <div
            className="flex items-center gap-1.5 py-1 px-1.5 sm:px-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/80 min-w-0"
            title={`${currentUser.name} (${nameFallback})`}
          >
            <div className="w-6 h-6 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 flex items-center justify-center text-xs font-bold shrink-0">
              {currentUser.name.charAt(0)}
            </div>
            <span
              className="text-xs font-bold text-slate-900 dark:text-white leading-tight truncate min-w-0 max-w-[80px] min-[360px]:max-w-[100px] min-[390px]:max-w-[130px]"
              title={currentUser.name}
            >
              {firstName}
            </span>
          </div>

          {/* Explicit Always-Visible Logout Button in Top Bar */}
          <button
            onClick={onLogout}
            className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 min-w-11 min-h-11 sm:min-w-0 sm:min-h-0 text-xs font-bold text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl border border-red-200 dark:border-red-900/60 transition-colors shrink-0 cursor-pointer"
            title="Oturumu Kapat (Çıkış Yap)"
            aria-label="Oturumu Kapat (Çıkış Yap)"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0 text-red-600" />
            <span className="font-bold hidden sm:inline">Çıkış Yap</span>
          </button>
        </div>
      </div>

      {/* Desktop navigation: visible labels from lg upwards (no icon-only ambiguity) */}
      <div className="hidden lg:block w-full max-w-full border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/95 dark:bg-slate-900/95">
        <nav className="w-full px-2.5 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-1.5 min-w-0">
          {mobileNavItems
            .filter((item) => !item.adminOnly || isAdmin)
            .map((item) => {
              const active = activeTab === item.tab;
              const Icon = item.icon;
              return (
                <button
                  key={item.tab}
                  type="button"
                  onClick={() => setActiveTab(item.tab)}
                  aria-label={item.ariaLabel}
                  title={item.ariaLabel}
                  className={`min-h-11 px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer border ${
                    active
                      ? `${item.activeClass} text-white border-transparent shadow-md`
                      : 'bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${active ? 'text-white' : item.iconClass}`}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
        </nav>
      </div>

      {/* Compact mobile navigation: four columns, two rows, no horizontal scrolling */}
      <div className="lg:hidden w-full max-w-full box-border border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/95 dark:bg-slate-900/95 px-2 py-2 grid grid-cols-4 gap-1.5 overflow-x-hidden">
        {mobileNavItems
          .filter((item) => !item.adminOnly || isAdmin)
          .map((item) => {
            const active = activeTab === item.tab;
            const Icon = item.icon;
            return (
              <button
                key={item.tab}
                type="button"
                onClick={() => setActiveTab(item.tab)}
                aria-label={item.ariaLabel}
                title={item.ariaLabel}
                className={`w-full min-h-[52px] px-1 py-1.5 rounded-lg text-[11px] font-semibold flex flex-col items-center justify-center gap-1 transition-all text-center cursor-pointer box-border ${
                  active
                    ? `${item.activeClass} text-white shadow-sm ring-1 ring-white/20 font-bold`
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-700/60'
                }`}
              >
                <Icon className={`w-5 h-5 shrink-0 ${active ? 'text-white' : item.iconClass}`} />
                <span className="w-full leading-tight break-words">{item.label}</span>
              </button>
            );
          })}
      </div>

      {refreshState !== 'idle' && (
        <div
          role={refreshState === 'error' ? 'alert' : 'status'}
          aria-live={refreshState === 'error' ? 'assertive' : 'polite'}
          className={`absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 max-w-[calc(100vw-1rem)] px-3 py-2 rounded-xl border shadow-lg text-xs font-semibold flex items-center gap-2 ${
            refreshState === 'error'
              ? 'bg-rose-50 dark:bg-rose-950 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              : refreshState === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
          }`}
        >
          {refreshState === 'loading' && (
            <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
          )}
          {refreshState === 'success' && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
          {refreshState === 'error' && <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
          <span className="break-words">
            {refreshState === 'loading'
              ? 'Veriler yenileniyor...'
              : refreshState === 'success'
              ? 'Veriler güncellendi'
              : 'Veriler güncellenemedi. Tekrar deneyin.'}
          </span>
        </div>
      )}
    </header>
  );
};

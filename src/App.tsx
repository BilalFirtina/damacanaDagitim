import { useState, useEffect, useCallback } from 'react';
import { User, Product, Customer, Dispatch, Delivery, setProductCategories } from './types';
import {
  fetchUsers,
  fetchProducts,
  fetchCategories,
  fetchCustomers,
  fetchDispatches,
  fetchDeliveries,
  logoutUser,
  normalizeDelivery,
  getAuthToken,
} from './services/api';
import { LoginView } from './components/auth/LoginView';
import { todayUtcDateStr } from './services/dateWindow';
import { Header } from './components/common/Header';
import { OfflineIndicator } from './components/common/OfflineIndicator';
import { DriverView } from './components/driver/DriverView';
import { LiveTeamFeed } from './components/driver/LiveTeamFeed';
import { EndOfDayView } from './components/driver/EndOfDayView';
import { DailyReportsView } from './components/admin/DailyReportsView';
import { CustomersManagement } from './components/admin/CustomersManagement';
import { ProductManagement } from './components/admin/ProductManagement';
import { VehicleLoadManagement } from './components/admin/VehicleLoadManagement';
import { DataRetentionView } from './components/admin/DataRetentionView';

const REMEMBERED_USER_KEY = 'sudagitim_remembered_user';
const SESSION_USER_KEY = 'sudagitim_session_user';

export default function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const savedUserRaw =
        localStorage.getItem(REMEMBERED_USER_KEY) ||
        sessionStorage.getItem(SESSION_USER_KEY);
      if (savedUserRaw) {
        return JSON.parse(savedUserRaw);
      }
    } catch {}
    return null;
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [activeTab, setActiveTab] = useState<
    'delivery' | 'team_feed' | 'eod' | 'customers' | 'products' | 'reports' | 'admin_loads' | 'retention'
  >('delivery');

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Load initial dataset
  const loadData = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const [uList, pList, cList, dList, delList] = await Promise.all([
        fetchUsers(),
        fetchProducts(),
        fetchCustomers(),
        fetchDispatches(),
        fetchDeliveries({ date: todayUtcDateStr() }),
      ]);

      // Kategori tanımlarını veritabanından yükle (veri odaklı sıralama/etiketleme).
      try {
        const categories = await fetchCategories();
        setProductCategories(categories);
      } catch {
        // Kategori servisi erişilemezse varsayılan kategoriler kullanılır.
      }

      setUsers(uList);
      setProducts(pList);
      setCustomers(cList);
      setDispatches(dList);
      setDeliveries(delList.map((d) => normalizeDelivery(d)));

      // Verify and sync active session against freshly retrieved users list
      const savedUserRaw =
        localStorage.getItem(REMEMBERED_USER_KEY) ||
        sessionStorage.getItem(SESSION_USER_KEY);

      if (savedUserRaw) {
        try {
          const parsed = JSON.parse(savedUserRaw);
          const found = uList.find((u) => u.id === parsed.id);
          if (found) {
            setCurrentUser(found);
          } else {
            // User revoked or removed
            localStorage.removeItem(REMEMBERED_USER_KEY);
            sessionStorage.removeItem(SESSION_USER_KEY);
            setCurrentUser(null);
          }
        } catch {
          setCurrentUser(null);
        }
      }
    } catch (err) {
      console.error('Failed to load system data', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadData();

    // Auto-poll deliveries and dispatches every 8 seconds for real-time inter-vehicle live feed.
    // Yalnızca oturum açıkken, çevrimiçiyken ve sekme görünürken sorgulanır;
    // gereksiz ağ isteklerini ve arka plan tüketimini önler.
    const interval = setInterval(async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (!getAuthToken()) return;
      try {
        // Gün her tetikte yeniden hesaplanır; gece yarısı geçişinde yeni gün
        // verisi çekilir ve önceki günün kayıtları state'te kalmaz.
        const [latestDeliveries, latestDispatches] = await Promise.all([
          fetchDeliveries({ date: todayUtcDateStr() }),
          fetchDispatches(),
        ]);
        setDeliveries(latestDeliveries.map((d) => normalizeDelivery(d)));
        setDispatches(latestDispatches);
      } catch {}
    }, 8000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onAuthExpired = () => {
      localStorage.removeItem(REMEMBERED_USER_KEY);
      sessionStorage.removeItem(SESSION_USER_KEY);
      setCurrentUser(null);
    };
    window.addEventListener('auth_expired', onAuthExpired);
    return () => window.removeEventListener('auth_expired', onAuthExpired);
  }, []);

  const handleLoginSuccess = (user: User, rememberMe: boolean) => {
    setCurrentUser(user);
    if (rememberMe) {
      localStorage.setItem(REMEMBERED_USER_KEY, JSON.stringify(user));
      sessionStorage.removeItem(SESSION_USER_KEY);
    } else {
      sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
      localStorage.removeItem(REMEMBERED_USER_KEY);
    }
    loadData();
  };

  const handleLogout = () => {
    localStorage.removeItem(REMEMBERED_USER_KEY);
    sessionStorage.removeItem(SESSION_USER_KEY);
    setCurrentUser(null);
    logoutUser();
  };

  // Find active dispatch for the current user (if driver) or first active dispatch for admin
  const todayStr = todayUtcDateStr();
  const currentDispatch =
    dispatches.find((d) => {
      if (d.date !== todayStr) return false;
      if (d.status === 'completed') return false;
      if (currentUser?.role === 'driver') {
        return d.driverId === currentUser.id;
      }
      // If admin, show first active dispatch
      return true;
    }) || null;

  const handleDispatchUpdated = (updated: Dispatch) => {
    // Oluşturma/güncelleme/onay/kapatma uçları kalıcı sefer kaydını (id, status,
    // sunucu zaman damgaları, mutabakat) döndürür ve durum bu yanıttan
    // güncellenir; bu nedenle tam veri yenilemesi (loadData) gerekmez.
    setDispatches((prev) => {
      const exists = prev.some((d) => d.id === updated.id);
      if (exists) {
        return prev.map((d) => (d.id === updated.id ? updated : d));
      }
      return [updated, ...prev];
    });
  };

  const handleDispatchCreated = (created: Dispatch) => {
    setDispatches((prev) => [created, ...prev]);
  };

  const handleDeliveryCreated = (newDelivery: Delivery, updatedCustomer?: Customer) => {
    setDeliveries((prev) => [normalizeDelivery(newDelivery, newDelivery.isOfflineSync), ...prev]);
    if (updatedCustomer) {
      setCustomers((prev) =>
        prev.map((c) => (c.id === updatedCustomer.id ? updatedCustomer : c))
      );
    }
  };

  const handleCustomerCreated = (created: Customer) => {
    setCustomers((prev) => {
      if (prev.some((c) => c.id === created.id)) {
        return prev.map((c) => (c.id === created.id ? created : c));
      }
      return [...prev, created];
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4">
        <img
          src="/logo-header.png"
          alt=""
          className="w-12 h-12 rounded-2xl bg-white ring-1 ring-slate-200 dark:ring-slate-700 shadow-xl object-contain animate-bounce"
        />
        <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
          Fırtına Gıda Yükleniyor...
        </h2>
        <p className="text-xs text-slate-500 mt-1">Saha ve mutabakat verileri hazırlanıyor</p>
      </div>
    );
  }

  // If user is not logged in, show dedicated Login View
  if (!currentUser) {
    return (
      <LoginView onLoginSuccess={handleLoginSuccess} />
    );
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50/80 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans">
      {/* Top Bar Header with 3-Zone Contract */}
      <Header
        currentUser={currentUser}
        onLogout={handleLogout}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onRefreshData={loadData}
        isRefreshing={isRefreshing}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-6 pb-20 min-w-0 overflow-x-hidden">
        {activeTab === 'delivery' && (
          <DriverView
            currentUser={currentUser}
            users={users}
            dispatches={dispatches}
            currentDispatch={currentDispatch}
            deliveries={deliveries}
            customers={customers}
            products={products}
            onDispatchUpdated={handleDispatchUpdated}
            onDeliveryCreated={handleDeliveryCreated}
            onDeliveryCorrected={loadData}
            onCustomerCreated={handleCustomerCreated}
            onNavigateTab={setActiveTab}
          />
        )}

        {activeTab === 'team_feed' && (
          <LiveTeamFeed
            deliveries={deliveries}
            currentUser={currentUser}
          />
        )}

        {activeTab === 'eod' && (
          <EndOfDayView
            dispatch={currentDispatch}
            dispatches={dispatches}
            deliveries={deliveries}
            products={products}
            currentUser={currentUser}
            onDispatchUpdated={handleDispatchUpdated}
            onNavigateTab={setActiveTab}
            onRefreshData={loadData}
          />
        )}

        {activeTab === 'customers' && (
          <CustomersManagement
            customers={customers}
            products={products}
            currentUser={currentUser}
            onCustomersUpdated={setCustomers}
          />
        )}

        {activeTab === 'products' && (
          <ProductManagement
            products={products}
            onProductsUpdated={setProducts}
            currentUser={currentUser}
          />
        )}

        {activeTab === 'reports' && (
          <DailyReportsView
            users={users}
            products={products}
            currentUser={currentUser}
          />
        )}

        {activeTab === 'admin_loads' && currentUser.role === 'admin' && (
          <VehicleLoadManagement
            dispatches={dispatches}
            users={users}
            products={products}
            currentUser={currentUser}
            onDispatchCreated={handleDispatchCreated}
            onUsersUpdated={setUsers}
          />
        )}

        {activeTab === 'retention' && currentUser.role === 'admin' && (
          <DataRetentionView />
        )}
      </main>

      {/* Offline Status & Background Queue Sync Indicator */}
      <OfflineIndicator />
    </div>
  );
}

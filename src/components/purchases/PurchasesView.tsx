import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, PackagePlus, ShoppingCart } from 'lucide-react';
import type { Product, Purchase, Supplier, User } from '../../types';
import {
  cancelPurchase,
  fetchPurchases,
  fetchSuppliers,
  getAuthToken,
} from '../../services/api';
import {
  canManagePurchase,
  sortPurchasesNewestFirst,
} from '../../services/purchaseRules';
import { PurchaseFeedCard } from './PurchaseFeedCard';
import { PurchaseFormModal } from './PurchaseFormModal';
import { SupplierManagerModal } from './SupplierManagerModal';

interface PurchasesViewProps {
  currentUser: User;
  products: Product[];
}

export const PurchasesView: React.FC<PurchasesViewProps> = ({
  currentUser,
  products,
}) => {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  const [supplierManagerOpen, setSupplierManagerOpen] = useState(false);

  const loadPurchases = useCallback(async () => {
    try {
      const list = await fetchPurchases();
      setPurchases(sortPurchasesNewestFirst(list));
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Satın alımlar alınamadı.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadSuppliers = useCallback(async () => {
    try {
      const list = await fetchSuppliers(currentUser.role === 'admin');
      setSuppliers(list);
    } catch (err: any) {
      setError(err?.message || 'Toptancılar alınamadı.');
    }
  }, [currentUser.role]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadPurchases(), loadSuppliers()]);
  }, [loadPurchases, loadSuppliers]);

  useEffect(() => {
    void refreshAll();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (!navigator.onLine) return;
      if (!getAuthToken()) return;
      void loadPurchases();
    }, 8000);
    return () => window.clearInterval(interval);
  }, [refreshAll, loadPurchases]);

  const handleCancel = async (purchase: Purchase) => {
    if (!window.confirm(`${purchase.supplierName} alımını iptal etmek istiyor musunuz?`)) {
      return;
    }
    try {
      await cancelPurchase(purchase.id);
      await loadPurchases();
    } catch (err: any) {
      setError(err?.message || 'Satın alım iptal edilemedi.');
    }
  };

  const openNewForm = () => {
    setEditingPurchase(null);
    setFormOpen(true);
  };

  const openEditForm = (purchase: Purchase) => {
    setEditingPurchase(purchase);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4 w-full max-w-full min-w-0">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-purple-600 shrink-0" />
            <span>Satın Alınanlar</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Toptancılardan alınan ürünler. Tüm ekip kayıtları görebilir; düzeltme/iptal
            kendi kaydınızla sınırlıdır.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {currentUser.role === 'admin' && (
            <button
              type="button"
              onClick={() => setSupplierManagerOpen(true)}
              className="min-h-11 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold text-xs hover:bg-slate-50"
            >
              Toptancıları Yönet
            </button>
          )}
          <button
            type="button"
            onClick={openNewForm}
            className="min-h-11 px-4 py-2 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs flex items-center justify-center gap-1.5"
          >
            <PackagePlus className="w-4 h-4" />
            Yeni Alım
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {isLoading && purchases.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-500">
          Satın alımlar yükleniyor...
        </div>
      ) : purchases.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-3">
          <PackagePlus className="w-8 h-8 text-purple-300 mx-auto" />
          <div className="text-sm font-semibold text-slate-700">
            Henüz satın alım kaydı yok.
          </div>
          <p className="text-xs text-slate-500">
            Toptancıdan alınan ürünleri ekleyerek başlayın.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {purchases.map((purchase) => (
            <PurchaseFeedCard
              key={purchase.id}
              purchase={purchase}
              canManage={canManagePurchase(purchase, currentUser)}
              onEdit={openEditForm}
              onCancel={handleCancel}
            />
          ))}
        </div>
      )}

      <PurchaseFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        products={products}
        suppliers={suppliers}
        currentUser={currentUser}
        editingPurchase={editingPurchase}
        onSaved={() => {
          void refreshAll();
        }}
        onOpenSuppliers={
          currentUser.role === 'admin'
            ? () => setSupplierManagerOpen(true)
            : undefined
        }
      />

      {currentUser.role === 'admin' && (
        <SupplierManagerModal
          open={supplierManagerOpen}
          onClose={() => setSupplierManagerOpen(false)}
          suppliers={suppliers}
          onChanged={() => {
            void refreshAll();
          }}
        />
      )}
    </div>
  );
};

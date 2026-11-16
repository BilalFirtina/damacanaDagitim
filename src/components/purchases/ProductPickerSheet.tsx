import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, PackageSearch, Search, X } from 'lucide-react';
import type { Product } from '../../types';
import { groupProductsByCategory, sortProductsForLoading } from '../../types';
import { filterPickerProducts } from '../../services/productPickerRules';

interface ProductPickerSheetProps {
  open: boolean;
  products: Product[];
  selectedProductId?: string;
  onSelect: (product: Product) => void;
  onClose: () => void;
}

// Satın alım formu için aranabilir ürün seçici.
// Mobilde alttan açılan panel, masaüstünde ortalanmış modal olarak çalışır.
export const ProductPickerSheet: React.FC<ProductPickerSheetProps> = ({
  open,
  products,
  selectedProductId,
  onSelect,
  onClose,
}) => {
  const [search, setSearch] = useState('');
  const [categoryCode, setCategoryCode] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const allGroups = useMemo(
    () => groupProductsByCategory(products, sortProductsForLoading),
    [products]
  );

  const visibleProducts = useMemo(
    () => filterPickerProducts(products, search, categoryCode),
    [products, search, categoryCode]
  );

  const visibleGroups = useMemo(
    () => groupProductsByCategory(visibleProducts, sortProductsForLoading),
    [visibleProducts]
  );

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setCategoryCode(null);
    // Mobilde klavye hemen açılmasın; masaüstünde aramaya odaklan.
    if (window.matchMedia('(min-width: 640px)').matches) {
      window.requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-picker-title"
        className="w-full sm:max-w-lg min-w-0 bg-white border border-slate-200 shadow-2xl rounded-t-2xl sm:rounded-2xl max-h-[88dvh] sm:max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <PackageSearch className="w-4 h-4 text-rose-600 shrink-0" />
            <h2 id="product-picker-title" className="text-sm font-bold text-slate-900">
              Ürün Seç
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-11 min-h-11 -mr-2 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center shrink-0"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pt-3 pb-2 space-y-2 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Ürün ara..."
              className="w-full min-h-11 pl-9 pr-10 p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-400"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-9 min-h-9 rounded-lg text-slate-400 hover:bg-slate-200 flex items-center justify-center"
                aria-label="Aramayı temizle"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {allGroups.map((group) => {
              const active = categoryCode === group.code;
              return (
                <button
                  key={group.code}
                  type="button"
                  onClick={() =>
                    setCategoryCode((current) =>
                      current === group.code ? null : group.code
                    )
                  }
                  className={`shrink-0 min-h-10 px-3 py-2 rounded-full border text-[11px] font-bold whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-rose-600 border-rose-600 text-white'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                  aria-pressed={active}
                >
                  {group.title}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          {visibleGroups.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <PackageSearch className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-sm font-semibold text-slate-600">
                Bu aramaya uygun ürün bulunamadı.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setCategoryCode(null);
                }}
                className="text-xs font-semibold text-rose-600 hover:underline"
              >
                Aramayı ve kategoriyi temizle
              </button>
            </div>
          ) : (
            visibleGroups.map((group) => (
              <div key={group.code}>
                <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-100">
                  {group.title}
                </div>
                <div className="divide-y divide-slate-100">
                  {group.products.map((product) => {
                    const selected = selectedProductId === product.id;
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => onSelect(product)}
                        className={`w-full min-h-12 px-4 py-2.5 flex items-center justify-between gap-3 text-left transition-colors ${
                          selected
                            ? 'bg-rose-50/70 hover:bg-rose-50'
                            : 'bg-white hover:bg-slate-50 active:bg-slate-100'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 break-words">
                            {product.name}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            <span className="text-[11px] font-semibold text-slate-500">
                              {product.unit || 'Adet'}
                            </span>
                            {product.isDeposit && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                Depozitolu
                              </span>
                            )}
                          </div>
                        </div>
                        {selected ? (
                          <Check className="w-4 h-4 text-rose-600 shrink-0" />
                        ) : (
                          <span className="text-[10px] font-semibold text-slate-400 shrink-0">
                            Seç
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

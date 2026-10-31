import React, { useEffect, useMemo, useState } from 'react';
import { Product } from '../../types';
import { StockResponse, adjustStock, fetchStock } from '../../services/api';
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  Boxes,
  CheckCircle2,
  History,
  Package,
  RefreshCw,
} from 'lucide-react';

interface StockViewProps {
  products: Product[];
  currentUser: { id: string; name: string };
}

// AGENTS.md Bölüm 4, 8 ve 10.2 — Depo stoğu, stok düzeltmesi ve hareket geçmişi.
export const StockView: React.FC<StockViewProps> = ({ products }) => {
  const [data, setData] = useState<StockResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [productId, setProductId] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sellableProducts = useMemo(() => products.filter((p) => !p.isDeposit), [products]);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchStock());
    } catch (err: any) {
      setError(err?.message || 'Depo stoğu alınamadı.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!productId && sellableProducts.length > 0) {
      setProductId(sellableProducts[0].id);
    }
  }, [sellableProducts, productId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const qty = Number(quantity);
    if (!productId) {
      setError('Ürün seçilmelidir.');
      return;
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      setError('Miktar sıfırdan büyük bir tam sayı olmalıdır.');
      return;
    }
    if (!reason.trim()) {
      setError('Gerekçe zorunludur.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await adjustStock({
        productId,
        delta: direction === 'in' ? qty : -qty,
        reason: reason.trim(),
      });
      setSuccess(result.message || 'Stok güncellendi.');
      setQuantity('');
      setReason('');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Stok düzeltmesi yapılamadı.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 w-full max-w-full min-w-0">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Boxes className="w-4 h-4 text-sky-600 shrink-0" />
              <span className="break-words">Depo Stok Yönetimi</span>
            </h2>
            <p className="text-xs text-slate-500">
              Yüklemeler depo stoğundan düşer. Her düzeltme gerekçesiyle kaydedilir.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={isLoading}
            className="shrink-0 p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
            aria-label="Yenile"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
        )}
        {success && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="break-words">{success}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="min-w-0">
              <span className="text-[11px] font-semibold text-slate-500 block mb-1">Ürün</span>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              >
                {sellableProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.unit})
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2 min-w-0">
              <label className="min-w-0">
                <span className="text-[11px] font-semibold text-slate-500 block mb-1">Yön</span>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as 'in' | 'out')}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                >
                  <option value="in">Giriş (+)</option>
                  <option value="out">Çıkış (−)</option>
                </select>
              </label>
              <label className="min-w-0">
                <span className="text-[11px] font-semibold text-slate-500 block mb-1">Miktar</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                  placeholder="0"
                />
              </label>
            </div>
          </div>

          <label className="block min-w-0">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">Gerekçe</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
              placeholder="Örn: Tedarikçiden mal alımı, sayım düzeltmesi"
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full sm:w-auto min-h-11 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-bold text-xs flex items-center justify-center gap-2"
          >
            {isSubmitting ? 'Kaydediliyor...' : 'Stok Hareketini Kaydet'}
          </button>
        </form>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
          <Package className="w-4 h-4 text-sky-600" />
          Güncel Depo Stoğu
        </h3>

        {isLoading && !data ? (
          <div className="p-8 text-center text-xs text-slate-400">Stok yükleniyor...</div>
        ) : (
          <div className="space-y-2">
            {(data?.items || []).map((item) => (
              <div
                key={item.productId}
                className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 min-w-0"
              >
                <div className="min-w-0">
                  <div className="font-bold text-xs text-slate-900 dark:text-white break-words">
                    {item.name}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {item.category} · {item.unit}
                  </div>
                </div>
                <div
                  className={`shrink-0 font-mono font-bold text-sm tabular-nums ${
                    item.quantity > 0
                      ? 'text-slate-900 dark:text-white'
                      : 'text-rose-600 dark:text-rose-300'
                  }`}
                >
                  {item.quantity}
                  <span className="text-[10px] font-normal text-slate-400 ml-1">{item.unit}</span>
                </div>
              </div>
            ))}
            {(data?.items || []).length === 0 && (
              <div className="p-6 text-center text-xs text-slate-400">
                Stok kaydı bulunmuyor. Yukarıdan stok girişi yapabilirsiniz.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
          <History className="w-4 h-4 text-indigo-600" />
          Son Stok Hareketleri
        </h3>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {(data?.movements || []).slice(0, 20).map((m) => (
            <div key={m.id} className="py-2.5 flex items-start gap-2.5 min-w-0">
              {m.delta >= 0 ? (
                <ArrowUpCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <ArrowDownCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-slate-900 dark:text-white break-words">
                  {m.productName}
                </div>
                <div className="text-[11px] text-slate-500 break-words">
                  {m.reason || m.sourceType} · {m.userName} ·{' '}
                  {new Date(m.createdAt).toLocaleString('tr-TR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div
                  className={`font-mono font-bold text-xs tabular-nums ${
                    m.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {m.delta >= 0 ? '+' : '−'}
                  {Math.abs(m.delta)}
                </div>
                <div className="text-[10px] text-slate-400 font-mono tabular-nums">
                  {m.quantityAfter}
                </div>
              </div>
            </div>
          ))}
          {(data?.movements || []).length === 0 && (
            <div className="p-6 text-center text-xs text-slate-400">Hareket kaydı bulunmuyor.</div>
          )}
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { GlassWater } from 'lucide-react';

// Cam damacana ve 0.33 lt cam su için ortak kart görünümü.
// Yalnızca görsel amaçlıdır; stok/emanet hesaplarına etki etmez.
export const GLASS_PRODUCT_CARD_CLASS =
  'border-cyan-200 bg-gradient-to-br from-cyan-50 via-sky-50 to-white ring-1 ring-cyan-100 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9)]';

export const GlassProductBadge: React.FC = () => (
  <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-white/80 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-cyan-700">
    <GlassWater className="w-2.5 h-2.5" />
    Cam
  </span>
);

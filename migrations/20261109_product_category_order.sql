-- Ürün kategorileri görüntüleme sırası.
-- İstenen sıra: Damacana, Pet Su, Maden Suyu / İçecek, Tüp,
-- Bardak & Sarf Malzeme, Su Sebili.
BEGIN;

UPDATE public.product_categories SET sort_order = 3 WHERE code = 'soda';
UPDATE public.product_categories SET sort_order = 4 WHERE code = 'tup';
UPDATE public.product_categories SET sort_order = 6 WHERE code = 'sebil';

COMMIT;

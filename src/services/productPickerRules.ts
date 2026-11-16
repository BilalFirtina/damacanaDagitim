import { getProductCategoryTitle } from '../types';

/**
 * Türkçe karakterleri arama için sadeleştirir. Yalnızca ürün seçicide
 * kullanılır; diğer arama akışlarının davranışı değişmez.
 */
function foldSearchText(value: string): string {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/â/g, 'a')
    .replace(/î/g, 'i')
    .replace(/û/g, 'u')
    .trim();
}

/**
 * Satın alım ürün seçicisi için arama + kategori filtresi.
 * Kategori seçilmemişse tüm kategoriler döner; seçiliyse yalnızca o kategori.
 */
export function filterPickerProducts<T extends { category: string; name: string }>(
  products: T[],
  search: string,
  categoryCode: string | null
): T[] {
  const source = categoryCode
    ? products.filter((product) => product.category === categoryCode)
    : products;

  const term = foldSearchText(search);
  if (!term) return [...source];

  return source.filter((product) => {
    const name = foldSearchText(product.name);
    const category = foldSearchText(product.category);
    const title = foldSearchText(getProductCategoryTitle(product.category));
    return name.includes(term) || category.includes(term) || title.includes(term);
  });
}

export interface EmptiesCounts {
  damacana: number;
  camDamacana: number;
  tupBuyuk?: number;
  tupKucuk?: number;
  sebil: number;
}

// Pure helper: attributes delivered quantities to a deposit bucket based solely on the
// product's canonical deposit_type (never on the display name). Unknown product IDs are
// intentionally ignored here so callers can validate them separately.
export function computeDeliveredDeposits(
  items: Array<{ productId: string; quantity: number }>,
  products: Array<{ id: string; depositType: string }>
): EmptiesCounts {
  const result: EmptiesCounts = {
    damacana: 0,
    camDamacana: 0,
    sebil: 0,
  };
  for (const item of items) {
    const prod = products.find((p) => p.id === item.productId);
    const qty = Number(item.quantity) || 0;
    if (prod?.depositType === 'damacana') result.damacana += qty;
    else if (prod?.depositType === 'cam_damacana') result.camDamacana += qty;
    else if (prod?.depositType === 'tup_buyuk')
      result.tupBuyuk = (result.tupBuyuk || 0) + qty;
    else if (prod?.depositType === 'tup_kucuk')
      result.tupKucuk = (result.tupKucuk || 0) + qty;
    else if (prod?.depositType === 'sebil') result.sebil += qty;
  }
  return result;
}

// Pure helper: delivered deposits minus empties physically collected from the customer.
// Positive value => customer keeps an outstanding empty-container liability.
/**
 * Boş tüp toplamı: büyük + küçük tüp.
 * Hem toplu göstergeler hem gün sonu özeti için kullanılır.
 */
export function totalTupEmpty(received: {
  tupBuyuk?: number;
  tupKucuk?: number;
} | null | undefined): number {
  const big = Number(received?.tupBuyuk) || 0;
  const small = Number(received?.tupKucuk) || 0;
  return big + small;
}

export function computeEmptyContainersDiff(
  delivered: EmptiesCounts,
  received: {
    damacana?: number;
    camDamacana?: number;
    cam_damacana?: number;
    tupBuyuk?: number;
    tupKucuk?: number;
    sebil?: number;
  }
): EmptiesCounts {
  const recvDamacana = Number(received.damacana) || 0;
  const recvCam = Number(received.camDamacana ?? received.cam_damacana) || 0;
  const recvTupBuyuk = Number(received.tupBuyuk) || 0;
  const recvTupKucuk = Number(received.tupKucuk) || 0;
  const result: EmptiesCounts = {
    damacana: delivered.damacana - recvDamacana,
    camDamacana: delivered.camDamacana - recvCam,
    sebil: delivered.sebil - (Number(received.sebil) || 0),
  };
  // Boyut alanları yalnızca veri varsa eklenir; eski kayıtların/testlerin
  // çıktısı gereksiz yeni alanlarla değişmez.
  if (delivered.tupBuyuk !== undefined || received.tupBuyuk !== undefined) {
    result.tupBuyuk = (Number(delivered.tupBuyuk) || 0) - recvTupBuyuk;
  }
  if (delivered.tupKucuk !== undefined || received.tupKucuk !== undefined) {
    result.tupKucuk = (Number(delivered.tupKucuk) || 0) - recvTupKucuk;
  }
  return result;
}

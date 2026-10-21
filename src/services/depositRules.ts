export interface EmptiesCounts {
  damacana: number;
  camDamacana: number;
  tup: number;
}

// Pure helper: attributes delivered quantities to a deposit bucket based solely on the
// product's canonical deposit_type (never on the display name). Unknown product IDs are
// intentionally ignored here so callers can validate them separately.
export function computeDeliveredDeposits(
  items: Array<{ productId: string; quantity: number }>,
  products: Array<{ id: string; depositType: string }>
): EmptiesCounts {
  const result: EmptiesCounts = { damacana: 0, camDamacana: 0, tup: 0 };
  for (const item of items) {
    const prod = products.find((p) => p.id === item.productId);
    const qty = Number(item.quantity) || 0;
    if (prod?.depositType === 'damacana') result.damacana += qty;
    else if (prod?.depositType === 'cam_damacana') result.camDamacana += qty;
    else if (prod?.depositType === 'tup') result.tup += qty;
  }
  return result;
}

// Pure helper: delivered deposits minus empties physically collected from the customer.
// Positive value => customer keeps an outstanding empty-container liability.
export function computeEmptyContainersDiff(
  delivered: EmptiesCounts,
  received: { damacana?: number; camDamacana?: number; cam_damacana?: number; tup?: number }
): EmptiesCounts {
  const recvDamacana = Number(received.damacana) || 0;
  const recvCam = Number(received.camDamacana ?? received.cam_damacana) || 0;
  const recvTup = Number(received.tup) || 0;
  return {
    damacana: delivered.damacana - recvDamacana,
    camDamacana: delivered.camDamacana - recvCam,
    tup: delivered.tup - recvTup,
  };
}

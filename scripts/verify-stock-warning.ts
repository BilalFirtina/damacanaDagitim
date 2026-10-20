import assert from 'node:assert/strict';
import {
  computeStockWarnings,
  getStockWarningSignature,
  shouldShowStockWarning,
  STOCK_WARNING_DURATION_MS,
} from '../src/services/stockWarning';

const loadedItems = [
  { productId: 'damacana', quantity: 10 },
  { productId: 'tup', quantity: 4 },
];

function check(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

check('oversell quantity produces a warning', () => {
  const warnings = computeStockWarnings(
    [{ productId: 'damacana', productName: 'Damacana', quantity: 11 }],
    loadedItems
  );
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].qty, 11);
  assert.equal(warnings[0].vehicleQty, 10);
});

check('equal or lower quantity produces no warning', () => {
  assert.deepEqual(
    computeStockWarnings(
      [{ productId: 'damacana', productName: 'Damacana', quantity: 10 }],
      loadedItems
    ),
    []
  );
  assert.deepEqual(
    computeStockWarnings(
      [{ productId: 'tup', productName: 'Tüp', quantity: 2 }],
      loadedItems
    ),
    []
  );
});

check('unknown product is treated as zero loaded stock', () => {
  const warnings = computeStockWarnings(
    [{ productId: 'yeni', productName: 'Yeni Ürün', quantity: 1 }],
    loadedItems
  );
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].vehicleQty, 0);
});

check('signature changes when the quantity changes', () => {
  const first = getStockWarningSignature(
    computeStockWarnings(
      [{ productId: 'damacana', productName: 'Damacana', quantity: 11 }],
      loadedItems
    )
  );
  const second = getStockWarningSignature(
    computeStockWarnings(
      [{ productId: 'damacana', productName: 'Damacana', quantity: 12 }],
      loadedItems
    )
  );
  assert.notEqual(first, second);
});

check('warning is visible before expiry and hidden after it', () => {
  const warnings = computeStockWarnings(
    [{ productId: 'damacana', productName: 'Damacana', quantity: 11 }],
    loadedItems
  );
  const now = 1_000_000;
  assert.equal(
    shouldShowStockWarning({
      warnings,
      dismissedSignature: null,
      expiresAt: now + STOCK_WARNING_DURATION_MS,
      now,
    }),
    true
  );
  assert.equal(
    shouldShowStockWarning({
      warnings,
      dismissedSignature: null,
      expiresAt: now + STOCK_WARNING_DURATION_MS,
      now: now + STOCK_WARNING_DURATION_MS,
    }),
    false
  );
});

check('warning hides when the quantity becomes valid', () => {
  assert.equal(
    shouldShowStockWarning({
      warnings: [],
      dismissedSignature: null,
      expiresAt: 9_999_999,
      now: 1_000_000,
    }),
    false
  );
});

check('tap dismissal hides only the current warning signature', () => {
  const warnings = computeStockWarnings(
    [{ productId: 'damacana', productName: 'Damacana', quantity: 11 }],
    loadedItems
  );
  const signature = getStockWarningSignature(warnings);
  const now = 1_000_000;
  const expiresAt = now + STOCK_WARNING_DURATION_MS;

  assert.equal(
    shouldShowStockWarning({ warnings, dismissedSignature: signature, expiresAt, now }),
    false
  );

  const changed = computeStockWarnings(
    [{ productId: 'damacana', productName: 'Damacana', quantity: 12 }],
    loadedItems
  );
  assert.equal(
    shouldShowStockWarning({ warnings: changed, dismissedSignature: signature, expiresAt, now }),
    true
  );
});

console.log('verify-stock-warning: all checks passed');

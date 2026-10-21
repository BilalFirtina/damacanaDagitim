import {
  CustomerDispenserInput,
  CustomerDispenserSuggestions,
} from '../types';

const BRAND_MODEL_MAX_LENGTH = 60;
const NOTE_MAX_LENGTH = 300;

export class CustomerDispenserValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'CustomerDispenserValidationError';
  }
}

function normalizeRequiredText(
  value: unknown,
  fieldLabel: string,
  maxLength: number
): string {
  if (typeof value !== 'string') {
    throw new CustomerDispenserValidationError(`${fieldLabel} zorunludur.`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new CustomerDispenserValidationError(`${fieldLabel} zorunludur.`);
  }
  if (normalized.length > maxLength) {
    throw new CustomerDispenserValidationError(
      `${fieldLabel} en fazla ${maxLength} karakter olabilir.`
    );
  }
  return normalized;
}

export function normalizeCustomerDispenserInput(
  value: unknown
): CustomerDispenserInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CustomerDispenserValidationError('Sebil bilgileri geçersiz.');
  }

  const input = value as Record<string, unknown>;
  const brand = normalizeRequiredText(
    input.brand,
    'Marka',
    BRAND_MODEL_MAX_LENGTH
  );
  const model = normalizeRequiredText(
    input.model,
    'Model',
    BRAND_MODEL_MAX_LENGTH
  );

  if (
    typeof input.quantity !== 'number' ||
    !Number.isInteger(input.quantity) ||
    input.quantity < 1
  ) {
    throw new CustomerDispenserValidationError(
      'Adet 1 veya daha büyük bir tam sayı olmalıdır.'
    );
  }

  let note: string | null = null;
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== 'string') {
      throw new CustomerDispenserValidationError('Açıklama metin olmalıdır.');
    }
    const normalizedNote = input.note.trim();
    if (normalizedNote.length > NOTE_MAX_LENGTH) {
      throw new CustomerDispenserValidationError(
        `Açıklama en fazla ${NOTE_MAX_LENGTH} karakter olabilir.`
      );
    }
    note = normalizedNote || null;
  }

  return {
    brand,
    model,
    quantity: input.quantity,
    note,
  };
}

export function buildCustomerDispenserSuggestions(
  rows: Array<{ brand: string; model: string }>
): CustomerDispenserSuggestions {
  const compare = (a: string, b: string) => a.localeCompare(b, 'tr');
  const brands = Array.from(
    new Set(rows.map((row) => row.brand.trim()).filter(Boolean))
  ).sort(compare);
  const models = Array.from(
    new Set(rows.map((row) => row.model.trim()).filter(Boolean))
  ).sort(compare);

  return { brands, models };
}

export function summarizeCustomerDispenserQuantity(
  rows: Array<{ quantity: number }>
): number {
  return rows.reduce((total, row) => total + row.quantity, 0);
}

import {
  CustomerDispenserInput,
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

function normalizeOptionalText(value: unknown, fieldLabel: string, maxLength: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new CustomerDispenserValidationError(`${fieldLabel} metin olmalıdır.`);
  }
  const normalized = value.trim();
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
  const brand = normalizeOptionalText(input.brand, 'Marka', BRAND_MODEL_MAX_LENGTH);
  const model = normalizeOptionalText(input.model, 'Model', BRAND_MODEL_MAX_LENGTH);

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

  // AGENTS.md 7.1: marka, model veya açıklamadan en az biri girilmelidir.
  if (!brand && !model && !note) {
    throw new CustomerDispenserValidationError(
      'En az marka, model veya açıklama girilmelidir.'
    );
  }

  return {
    brand,
    model,
    quantity: input.quantity,
    note,
  };
}

import type { EmptiesCounts } from './depositRules';

const NEGATIVE_LABELS: Record<keyof EmptiesCounts, string> = {
  damacana: 'boş damacana',
  camDamacana: 'boş cam damacana',
  tup: 'boş tüp',
};

export function negativeEmptyMessages(
  balance: Partial<EmptiesCounts> | null | undefined
): string[] {
  const messages: string[] = [];
  (Object.keys(NEGATIVE_LABELS) as Array<keyof EmptiesCounts>).forEach((type) => {
    const quantity = Number(balance?.[type]) || 0;
    if (quantity < 0) {
      messages.push(
        `Müşteriye ${Math.abs(quantity)} ${NEGATIVE_LABELS[type]} borcumuz var`
      );
    }
  });
  return messages;
}

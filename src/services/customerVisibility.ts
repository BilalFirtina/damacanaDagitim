import type { Customer, Delivery } from '../types';

// AGENTS.md 6.1 — Müşteri türlerine göre finansal görünürlük.
//
// Peşin müşteri (isAccountCustomer = false): şoför bakiyeyi görür.
// Faturalı müşteri (isAccountCustomer = true): bakiyeyi yalnızca yönetici görür.
// Şoför oturumunda faturalı müşterinin parasal bakiyesi sıfırlanır; iade
// edilebilir kalem miktarları (boş damacana, cam, tüp, sebil) korunur.
export function maskCustomerFinancialsForDriver(
  customer: Customer,
  actor: { role?: string } | undefined
): Customer {
  if (!actor || actor.role !== 'driver') return customer;
  if (!customer.isAccountCustomer) return customer;
  return { ...customer, currentBalanceTL: 0 };
}

/**
 * Faturalı müşteri teslimatı mı?
 * Sunucu yanıtındaki `isAccountCustomer` alanı eski önbellek kayıtlarında
 * bulunmayabilir; bu durumda müşteri listesinden türetilir.
 */
export function isAccountCustomerDelivery(
  delivery: Pick<Delivery, 'customerId' | 'isAccountCustomer'> | null | undefined,
  customers?: Array<Pick<Customer, 'id' | 'isAccountCustomer'>>
): boolean {
  if (!delivery) return false;
  if (typeof delivery.isAccountCustomer === 'boolean') {
    return delivery.isAccountCustomer;
  }
  return Boolean(
    customers?.find((customer) => customer.id === delivery.customerId)
      ?.isAccountCustomer
  );
}

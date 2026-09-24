import {PAYMENT_SOURCE, type PaymentSource} from './types';

/**
 * What a payment is for, as the ERP names it: a model and a record id. One
 * pair instead of one relation per kind of subject, so a source that pays for
 * a new kind of record adds its model here and to the ERP's
 * `portal.payment.subject.select` and `PortalPaymentSubjects`, and no column.
 */
export const SUBJECT_MODEL = {
  invoice: 'com.axelor.apps.account.db.Invoice',
  registration: 'com.axelor.apps.portal.db.Registration',
  marketplaceOrder: 'com.axelor.apps.portal.db.MarketplaceProductOrder',
  orderRequest: 'com.axelor.apps.portal.db.PortalOrderRequest',
  saleOrder: 'com.axelor.apps.sale.db.SaleOrder',
} as const;

export type SubjectModel = (typeof SUBJECT_MODEL)[keyof typeof SUBJECT_MODEL];

export type Subject = {model: SubjectModel; id: string};

type SubjectSpec = {
  /** The table the record lives in, to check that it exists. */
  table: string;
  /**
   * Whether the record can carry only one payment. An invoice takes several:
   * partial payments, or a shop order's balance paid after its advance.
   */
  exclusive: boolean;
};

const SUBJECTS: Record<SubjectModel, SubjectSpec> = {
  [SUBJECT_MODEL.invoice]: {table: 'account_invoice', exclusive: false},
  [SUBJECT_MODEL.registration]: {table: 'portal_registration', exclusive: true},
  [SUBJECT_MODEL.marketplaceOrder]: {
    table: 'portal_marketplace_product_order',
    exclusive: true,
  },
  [SUBJECT_MODEL.orderRequest]: {
    table: 'portal_portal_order_request',
    exclusive: true,
  },
  [SUBJECT_MODEL.saleOrder]: {table: 'sale_sale_order', exclusive: true},
};

/* A shop purchase becomes an order request; a sale order is its subject only
 * when a person honoured the purchase by hand in the ERP. */
const MODELS_BY_SOURCE: Record<PaymentSource, readonly SubjectModel[]> = {
  [PAYMENT_SOURCE.invoices]: [SUBJECT_MODEL.invoice],
  [PAYMENT_SOURCE.events]: [SUBJECT_MODEL.registration],
  [PAYMENT_SOURCE.marketplace]: [SUBJECT_MODEL.marketplaceOrder],
  [PAYMENT_SOURCE.shop]: [SUBJECT_MODEL.orderRequest, SUBJECT_MODEL.saleOrder],
};

export function allowsSubject(source: PaymentSource, model: string): boolean {
  return MODELS_BY_SOURCE[source].some(allowed => allowed === model);
}

export function subjectTable(model: SubjectModel): string {
  return SUBJECTS[model].table;
}

/** The columns a subject is written to: its exclusive id is empty for one that takes several payments. */
export function subjectColumns(subject: Subject) {
  return {
    subjectModel: subject.model,
    subjectId: subject.id,
    exclusiveSubjectId: SUBJECTS[subject.model].exclusive ? subject.id : null,
  };
}

/** The payment's subject as stored, or null when it has none yet or names a model we do not know. */
export function readSubject(
  model: string | null,
  id: string | null,
): Subject | null {
  if (!model || !id) {
    return null;
  }
  const known = Object.values(SUBJECT_MODEL).find(value => value === model);
  return known ? {model: known, id} : null;
}

/** The subject's id when it is of the given model, else null. */
export function subjectIdOf(
  subject: Subject | null,
  model: SubjectModel,
): string | null {
  return subject?.model === model ? subject.id : null;
}

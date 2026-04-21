// ---- CORE IMPORTS ---- //
import type {ID} from '@/types';
import type {PortalWorkspace} from '@/orm/workspace';

export type Quotations = {
  id: ID;
  archived?: boolean;
  createdOn: string;
  deliverState?: string;
  saleOrderSeq: string;
  statusSelect: number | string;
  externalReference: string;
};

export type ColumnProps = {
  key: string;
  label: string;
};
export type QuotationsTableProps = {
  columns: ColumnProps[];
  quotations: Quotations[];
  onClick: (id: string | number) => void;
};

export type CardViewProps = {
  quotations: Quotations[];
  onClick: (id: string | number) => void;
};

export type Product = {
  id: ID;
  productName: string;
  qty: string | number;
  exTaxTotal: string;
  discountAmount: string | number;
  priceDiscounted: string;
  inTaxTotal: string;
  unit: {
    id: ID;
    name: string;
  };
  taxLine: {
    id: ID;
    name: string;
    value: string | number;
  };
};

export type CommentsProps = {
  id: ID;
  createdOn: string;
  updatedOn: string;
  subject: string;
  body: any;
  type: string;
  author: {
    name: string | undefined;
  };
};

export type Quotation = {
  clientPartner: {
    fullName: string;
    id: ID;
  };
  company: {
    id: ID;
    name: string;
  };
  currency: {
    id: ID;
    code: string;
    symbol: string;
    numberOfDecimals: number | string;
  };
  deliveryAddress: {
    id: ID;
    addressl4: string;
    addressl6: string;
    zip: string;
    country: {
      id: ID;
      name: string;
    };
  };
  endOfValidityDate: string | null | undefined;
  exTaxTotal: string;
  displayExTaxTotal: string;
  id: ID;
  inTaxTotal: string;
  displayInTaxTotal: string;
  mainInvoicingAddress: {
    id: ID;
    addressl4: string;
    addressl6: string;
    zip: string;
    country: {
      id: ID;
      name: string;
    };
  };
  saleOrderLineList: Product[];
  saleOrderSeq: string | number;
  statusSelect: string | number;
  totalDiscount: number | string;
};

export type TotalProps = {
  inTaxTotal: string;
  exTaxTotal: number | string;
  totalDiscount: number | string;
  statusSelect: string | number;
  hideDiscount: boolean;
};

export type InfoProps = {
  endOfValidityDate: string | null | undefined;
  statusSelect: string | number;
};

export type ContactProps = {
  clientPartner?: {
    fullName: string;
    id: ID;
  };
  company?: {
    id: ID;
    name: string;
  };
  mainInvoicingAddress: {
    id: ID;
    addressl4: string;
    addressl6: string;
    zip: string;
    country: {
      id: ID;
      name: string;
    };
    firstName?: string;
    lastName?: string;
    companyName?: string;
  };
  deliveryAddress: {
    id: ID;
    addressl4: string;
    addressl6: string;
    zip: string;
    country: {
      id: ID;
      name: string;
    };
    firstName?: string;
    lastName?: string;
    companyName?: string;
  };
};

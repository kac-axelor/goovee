import {type BigDecimal} from '@goovee/orm';

export type * from './search-param';

export type Company = {
  id: string;
  version: number;
  name: string | null;
};

export type Category = {
  id: string;
  version: number;
  name: string | null;
};

export type Priority = {
  id: string;
  version: number;
  name: string | null;
};

export type LinkType = {id: string; version: number; name: string};

export type TicketSearch = {
  id: string;
  version: number;
  fullName: string | null;
  name: string | null;
};

export type Status = {
  id: string;
  version: number;
  name: string | null;
  sequence: number | null;
  isCompleted: boolean | null;
};

export type ClientPartner = {
  id: string;
  version: number;
  simpleFullName: string | null;
};

export type ContactPartner = {
  id: string;
  version: number;
  simpleFullName: string | null;
};

export type TicketListTicket = {
  id: string;
  version: number;
  name: string;
  assignment: number | null;
  assignedTo: {
    id: string;
    version: number;
    name: string | null;
  } | null;
  managedByContact: {
    id: string;
    version: number;
    simpleFullName: string | null;
  } | null;
  createdByContact: {
    id: string;
    version: number;
    simpleFullName: string | null;
  } | null;
  priority: {
    id: string;
    version: number;
    name: string | null;
  } | null;
  project: {
    id: string;
    version: number;
    name: string | null;
    clientPartner: {
      id: string;
      version: number;
      simpleFullName: string | null;
    } | null;
    company: {
      id: string;
      version: number;
      name: string | null;
    } | null;
  } | null;
  status: {
    id: string;
    version: number;
    name: string | null;
  } | null;
  projectTaskCategory: {
    id: string;
    version: number;
    name: string | null;
  } | null;
  updatedOn: Date | null;
  _count?: string | null;
};

export type TicketLink = {
  id: string;
  version: number;
  projectTaskLinkType: {
    id: string;
    version: number;
    name: string | null;
  } | null;
  relatedTask: {
    id: string;
    version: number;
    name: string | null;
    assignment: number | null;
    assignedTo: {
      id: string;
      version: number;
      name: string | null;
    } | null;
    managedByContact: {
      id: string;
      version: number;
      simpleFullName: string | null;
    } | null;
    createdByContact: {
      id: string;
      version: number;
      simpleFullName: string | null;
    } | null;
    priority: {id: string; version: number; name: string | null} | null;
    project: {
      id: string;
      version: number;
      name: string | null;
      company: {
        id: string;
        version: number;
        name: string | null;
      } | null;
      clientPartner: {
        id: string;
        version: number;
        simpleFullName: string | null;
      } | null;
    } | null;
    status: {id: string; version: number; name: string | null} | null;
    projectTaskCategory: {
      id: string;
      version: number;
      name: string | null;
    } | null;
    updatedOn: Date | null;
  } | null;
};

export type ChildTicket = {
  id: string;
  version: number;
  name: string | null;
  assignment: number | null;
  assignedTo: {
    id: string;
    version: number;
    name: string | null;
  } | null;
  managedByContact: {
    id: string;
    version: number;
    simpleFullName: string | null;
  } | null;
  createdByContact: {
    id: string;
    version: number;
    simpleFullName: string | null;
  } | null;
  priority: {id: string; version: number; name: string | null} | null;
  project: {
    id: string;
    version: number;
    name: string | null;
    company: {
      id: string;
      version: number;
      name: string | null;
    } | null;
    clientPartner: {
      id: string;
      version: number;
      simpleFullName: string | null;
    } | null;
  } | null;
  status: {id: string; version: number; name: string | null} | null;
  projectTaskCategory: {
    id: string;
    version: number;
    name: string | null;
  } | null;
  updatedOn: Date | null;
};

export type ParentTicket = {
  id: string;
  version: number;
  name: string | null;
  assignment: number | null;
  assignedTo: {
    id: string;
    version: number;
    name: string | null;
  } | null;
  managedByContact: {
    id: string;
    version: number;
    simpleFullName: string | null;
  } | null;
  createdByContact: {
    id: string;
    version: number;
    simpleFullName: string | null;
  } | null;
  priority: {id: string; version: number; name: string | null} | null;
  project: {
    id: string;
    version: number;
    name: string | null;
    company: {
      id: string;
      version: number;
      name: string | null;
    } | null;
    clientPartner: {
      id: string;
      version: number;
      simpleFullName: string | null;
    } | null;
  } | null;
  status: {id: string; version: number; name: string | null} | null;
  projectTaskCategory: {
    id: string;
    version: number;
    name: string | null;
  } | null;
  updatedOn: Date | null;
};

export type Ticket = {
  id: string;
  version: number;
  name: string | null;
  invoicingType: number | null;
  invoicingUnit: {
    id: string;
    version: number;
    name: string | null;
  } | null;
  taskEndDate: string | null;
  displayFinancialData: boolean | null;
  description: string | null;
  assignment: number | null;
  assignedTo: {
    id: string;
    version: number;
    name: string | null;
  } | null;
  managedByContact: {
    id: string;
    version: number;
    simpleFullName: string | null;
  } | null;
  createdByContact: {
    id: string;
    version: number;
    simpleFullName: string | null;
  } | null;
  priority: {id: string; version: number; name: string | null} | null;
  project: {
    id: string;
    version: number;
    name: string | null;
    company: {
      id: string;
      version: number;
      name: string | null;
    } | null;
    clientPartner: {
      id: string;
      version: number;
      simpleFullName: string | null;
    } | null;
  } | null;
  status: {
    id: string;
    version: number;
    name: string | null;
    isCompleted: boolean | null;
  } | null;
  targetVersion: {
    id: string;
    version: number;
    title: string | null;
  } | null;
  projectTaskCategory: {
    id: string;
    version: number;
    name: string | null;
  } | null;
  progress: BigDecimal | null;
  quantity: BigDecimal | null;
  createdOn: Date | null;
};

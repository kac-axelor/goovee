import {PortalWorkspace} from '@/orm/workspace';
import type {Cloned} from '@/types/util';
import type {FullEvent} from '@/subapps/events/common/orm/event';

export interface EventPageCardProps {
  eventDetails: Cloned<FullEvent>;
  metaFields?: any[];
  workspace: PortalWorkspace | Cloned<PortalWorkspace>;
  user?: any;
}

// ---- CORE IMPORTS ---- //
import {SUBAPP_CODES} from '@/constants';
import type {Cloned} from '@/types/util';
import {PortalWorkspace} from '@/orm/workspace';

// ---- LOCAL IMPORTS ---- //
import type {TrackObject} from '../types';
import {TrackObjectSchema} from './validators';

export const isCommentEnabled = ({
  subapp,
  workspace,
}: {
  subapp: SUBAPP_CODES;
  workspace: PortalWorkspace | Cloned<PortalWorkspace>;
}) => {
  const config: Partial<Record<SUBAPP_CODES, boolean>> = {
    [SUBAPP_CODES.events]: workspace.config?.enableEventComment ?? false,
    [SUBAPP_CODES.news]: workspace.config?.enableNewsComment ?? false,
  };

  if (Object.keys(config).includes(subapp)) {
    return !!(workspace.config?.enableComment && config[subapp]);
  }
  return !!workspace.config?.enableComment;
};

export const parseCommentContent = (
  data: unknown,
): string | TrackObject | null => {
  try {
    if (typeof data !== 'string') return null;
    const parsed = TrackObjectSchema.parse(JSON.parse(data));
    return parsed;
  } catch {
    if (typeof data === 'string') {
      return data;
    }
    return null;
  }
};

export const isTrackObject = (data: unknown): data is TrackObject => {
  return typeof data === 'object' && data !== null;
};

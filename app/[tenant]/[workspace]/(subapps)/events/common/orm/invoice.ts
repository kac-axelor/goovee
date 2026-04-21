import axios from 'axios';
import type {Cloned} from '@/types/util';

// ---- CORE IMPORTS ---- //
import {t} from '@/locale/server';
import type {TenantConfig} from '@/tenant';
import {ID} from '@/types';
import {PortalWorkspace} from '@/orm/workspace';

// ---- LOCAL IMPORTS ---- //
import {error} from '@/subapps/events/common/utils';
import {ActionResponse} from '@/types/action';

export async function createInvoice({
  workspace,
  config,
  registrationId,
  currencyCode,
  paymentModeId,
}: {
  workspace: PortalWorkspace | Cloned<PortalWorkspace>;
  config: TenantConfig;
  registrationId: ID;
  currencyCode: string;
  paymentModeId?: string;
}): ActionResponse<any> {
  const aos = config?.aos;

  if (!aos?.url) {
    return error(await t('Invoice creation failed. Webservice not available.'));
  }

  const ws = `${aos.url}/ws/portal/invoice/eventInvoice`;

  try {
    const partnerWorkspaceId = workspace?.workspacePermissionConfig?.id;
    if (!partnerWorkspaceId) {
      return error(await t('Partner workspace id is missing.'));
    }

    const payload = {
      currencyCode,
      partnerWorkspaceId,
      registrationId,
      paymentModeId,
    };

    const {data} = await axios.post(ws, payload, {
      auth: {
        username: aos.auth.username,
        password: aos.auth.password,
      },
    });

    if (data?.status === -1) {
      return error(
        await t(
          data?.message ||
            'Unable to create the invoice. Please try again later.',
        ),
      );
    }

    return {success: true, data};
  } catch (err) {
    console.error('Invoice creation failed:', err);
    return error(
      await t(
        'An error occurred while processing your invoice. Please try again later.',
      ),
    );
  }
}

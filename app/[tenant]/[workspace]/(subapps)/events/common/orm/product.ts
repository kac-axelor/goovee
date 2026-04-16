import axios from 'axios';

// ---- CORE IMPORTS ---- //
import type {Client} from '@/goovee/.generated/client';
import type {TenantConfig} from '@/tenant';
import {findWorkspace} from '@/orm/workspace';
import {t} from '@/locale/server';
import {getSession} from '@/auth';

export async function findProductsFromWS({
  workspaceURL,
  client,
  config,
  eventId,
}: {
  workspaceURL: string;
  eventId: string | number;
  client: Client;
  config: TenantConfig;
}) {
  if (!workspaceURL && eventId) {
    return null;
  }

  if (!config?.aos?.url) {
    return [];
  }

  const session = await getSession();
  const user = session?.user;

  const workspace = await findWorkspace({
    url: workspaceURL,
    user,
    client,
  });

  if (!workspace) {
    return {
      error: true,
      message: await t('Invalid workspace'),
    };
  }
  const {aos} = config;

  const ws = `${aos.url}/ws/portal/event/price`;

  const partnerId = user?.id;

  try {
    const reqBody = {
      eventId,
      partnerWorkspaceId: workspace.id,
      partnerId,
    };
    const res = await axios
      .post(ws, reqBody, {
        auth: {
          username: aos.auth.username,
          password: aos.auth.password,
        },
      })
      .then(({data}) => data);

    if (res?.data?.status === -1) {
      console.log('Error:', res);
      return null;
    }

    return res?.data || null;
  } catch (err) {
    console.log('Error:', err);
    return null;
  }
}

import {NextRequest, NextResponse} from 'next/server';

// ---- CORE IMPORTS ---- //
import {SUBAPP_CODES} from '@/constants';
import {getSession} from '@/lib/core/auth';
import {manager} from '@/tenant';
import {findSubappAccess, findWorkspace} from '@/orm/workspace';
import {findFile, streamFile} from '@/utils/download';
import {workspacePathname} from '@/utils/workspace';

export async function GET(
  request: NextRequest,
  props: {params: Promise<{tenant: string; workspace: string}>},
) {
  const params = await props.params;
  const {workspaceURL, tenant: tenantId} = workspacePathname(params);

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) {
    return new NextResponse('Bad Request', {status: 400});
  }
  const {client} = tenant;

  const session = await getSession();

  const workspace = await findWorkspace({
    user: session?.user,
    url: workspaceURL,
    client,
  });

  if (!workspace) {
    return new NextResponse('Invalid workspace', {status: 401});
  }

  const subapp = await findSubappAccess({
    code: SUBAPP_CODES.forum,
    user: session?.user,
    url: workspaceURL,
    client,
  });
  if (!subapp) {
    return new NextResponse('Unauthorized', {status: 401});
  }

  const bgImageId = workspace.config?.forumHeroBgImage?.id;

  if (!bgImageId) {
    return new NextResponse('Image not found', {status: 404});
  }

  const file = await findFile({
    id: bgImageId,
    meta: true,
    client: tenant.client,
    storage: tenant.config.aos.storage,
  });

  if (!file) {
    return new NextResponse('File not found', {status: 404});
  }

  return streamFile(file);
}

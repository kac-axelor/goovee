import {NextRequest, NextResponse} from 'next/server';

import {getSession} from '@/auth';
import {SUBAPP_CODES} from '@/constants';
import {manager} from '@/tenant';
import {findSubappAccess, findWorkspace} from '@/orm/workspace';
import {findFile, streamFile} from '@/utils/download';
import {workspacePathname} from '@/utils/workspace';

import {isAttachmentOfNews} from '@/subapps/news/common/orm/news';

export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{
      tenant: string;
      workspace: string;
      slug: string;
      'file-id': string;
    }>;
  },
) {
  const params = await props.params;
  const {workspaceURL, tenant: tenantId} = workspacePathname(params);
  const {slug, 'file-id': fileId} = params;

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) {
    return new NextResponse('Bad Request', {status: 400});
  }
  const {client} = tenant;

  const session = await getSession();
  const user = session?.user;

  const workspace = await findWorkspace({
    user,
    url: workspaceURL,
    client,
  });

  if (!workspace) {
    return new NextResponse('Invalid workspace', {status: 401});
  }

  const app = await findSubappAccess({
    code: SUBAPP_CODES.news,
    user,
    url: workspaceURL,
    client,
  });
  if (!app?.isInstalled) {
    return new NextResponse('Unauthorized', {status: 401});
  }

  const attachmentBelongsToNews = await isAttachmentOfNews({
    slug,
    fileId,
    workspace,
    client,
    user,
  });

  if (!attachmentBelongsToNews) {
    return new NextResponse('Attachment not found', {status: 404});
  }

  const file = await findFile({
    id: fileId,
    meta: true,
    client: tenant.client,
    storage: tenant.config.aos.storage,
  });

  if (!file) {
    return new NextResponse('File not found', {status: 404});
  }

  return streamFile(file);
}

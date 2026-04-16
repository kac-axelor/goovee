import {findFile, streamFile} from '@/utils/download';
import {workspacePathname} from '@/utils/workspace';
import {NextRequest, NextResponse} from 'next/server';
import {ensureAuth} from '../../../common/utils/auth-helper';

export async function GET(
  request: NextRequest,
  props: {params: Promise<{tenant: string; workspace: string}>},
) {
  const params = await props.params;
  const {workspaceURL, tenant} = workspacePathname(params);

  const {error, auth} = await ensureAuth(workspaceURL, tenant);
  if (error) {
    return new NextResponse('Unauthorized', {status: 401});
  }

  const {workspace} = auth;
  const bgImageId = workspace.config.ticketHeroBgImage?.id;

  if (!bgImageId) {
    return new NextResponse('Image not found', {status: 404});
  }

  const file = await findFile({
    id: bgImageId,
    meta: true,
    client: auth.tenant.client,
    storage: auth.tenant.config.aos.storage,
  });

  if (!file) {
    return new NextResponse('File not found', {status: 404});
  }

  return streamFile(file);
}

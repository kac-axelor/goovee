import {NextRequest, NextResponse} from 'next/server';

import {getSession} from '@/auth';
import {isFileOfRecord} from '@/comments/orm';
import {SUBAPP_CODES} from '@/constants';
import {isCommentEnabled} from '@/lib/core/comments';
import {findSubappAccess, findWorkspace} from '@/orm/workspace';
import {PartnerKey} from '@/types';
import {findFile, streamFile} from '@/utils/download';
import {getWhereClauseForEntity} from '@/utils/filters';
import {workspacePathname} from '@/utils/workspace';
import {findQuotation} from '../../../../../common/orm/quotations';
import {manager} from '@/tenant';

export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{
      tenant: string;
      workspace: string;
      'quotation-id': string;
      'file-id': string;
    }>;
  },
) {
  const params = await props.params;
  const {workspaceURL, tenant: tenantId} = workspacePathname(params);
  const {'quotation-id': quotationId, 'file-id': fileId} = params;

  const session = await getSession();
  const user = session?.user;
  if (!user) {
    return new NextResponse('Unauthorized', {status: 401});
  }

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return new NextResponse('Bad Request', {status: 400});
  const {client} = tenant;

  const workspace = await findWorkspace({
    user,
    url: workspaceURL,
    client,
  });

  if (!workspace) {
    return new NextResponse('Invalid workspace', {status: 401});
  }

  if (!isCommentEnabled({subapp: SUBAPP_CODES.quotations, workspace})) {
    return new NextResponse('Forbidden', {status: 403});
  }

  const app = await findSubappAccess({
    code: SUBAPP_CODES.quotations,
    user,
    url: workspaceURL,
    client,
  });
  if (!app?.isInstalled) {
    return new NextResponse('Unauthorized', {status: 401});
  }

  const {role, isContactAdmin} = app;

  const quotationWhereClause = getWhereClauseForEntity({
    user,
    role,
    isContactAdmin,
    partnerKey: PartnerKey.CLIENT_PARTNER,
  });

  const quotation = await findQuotation({
    id: quotationId,
    client,
    params: {where: quotationWhereClause},
    workspaceURL,
  });

  if (!quotation) {
    return new NextResponse('Forbidden', {status: 403});
  }

  if (!(await isFileOfRecord({recordId: quotationId, fileId, client}))) {
    return new NextResponse('Forbidden', {status: 403});
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

// ---- CORE IMPORTS ---- //
import {getWhereClauseForEntity} from '@/utils/filters';
import {PartnerKey, User} from '@/types';
import type {Client} from '@/goovee/.generated/client';

// ---- LOCAL IMPORT ---- //
import {findQuotation} from '@/app/[tenant]/[workspace]/(subapps)/quotations/common/orm/quotations';

export async function getQuotationRecord({
  id,
  user,
  client,
  workspaceURL,
  subapp,
}: {
  id: string;
  user: User;
  client: Client;
  workspaceURL: string;
  subapp: {
    role: string;
    isContactAdmin: boolean;
  };
}) {
  const {role, isContactAdmin} = subapp;
  const quotationWhereClause = getWhereClauseForEntity({
    user,
    role,
    isContactAdmin,
    partnerKey: PartnerKey.CLIENT_PARTNER,
  });

  return await findQuotation({
    id,
    client,
    params: {where: quotationWhereClause},
    workspaceURL,
  });
}

// ---- CORE IMPORTS ---- //
import type {Client} from '@/goovee/.generated/client';
import type {User, PortalWorkspace} from '@/types';
import {getPartnerId} from '@/utils';

export async function shouldHidePricesAndPurchase({
  user,
  workspace,
  client,
}: {
  user: User | undefined;
  workspace: PortalWorkspace;
  client: Client;
}) {
  const {hidePriceForEmptyPricelist} = workspace.config || {};
  if (hidePriceForEmptyPricelist) {
    if (!user) return true;
    const mainPartner = await client.aOSPartner.findOne({
      where: {
        id: getPartnerId(user),
      },
      select: {
        salePartnerPriceList: {id: true},
      },
    });
    if (!mainPartner?.salePartnerPriceList?.id) return true;
  }
  return false;
}

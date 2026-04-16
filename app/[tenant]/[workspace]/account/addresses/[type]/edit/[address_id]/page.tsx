import {redirect} from 'next/navigation';
import {notFound} from 'next/navigation';

// ---- CORE IMPORRS ---- //
import {ADDRESS_TYPE, SUBAPP_PAGE} from '@/constants';
import {clone, getPartnerId} from '@/utils';
import {getSession} from '@/auth';
import {findCountries, findPartnerAddress} from '@/orm/address';
import {findGooveeUserByEmail, PartnerTypeMap} from '@/orm/partner';
import {workspacePathname} from '@/utils/workspace';
import {manager} from '@/lib/core/tenant';

// ---- LOCAL IMPORTS ---- //
import Content from './content';

export default async function Page(props: {
  params: Promise<{
    id: string;
    tenant: string;
    workspace: string;
    type: ADDRESS_TYPE;
    address_id: string;
  }>;
}) {
  const params = await props.params;
  const {tenant: tenantId, type, address_id} = params;
  const {workspaceURI} = workspacePathname(params);

  const REDIRECT_ADDRESS_URL = `${workspaceURI}/${SUBAPP_PAGE.account}/${SUBAPP_PAGE.addresses}`;

  if (![ADDRESS_TYPE.invoicing, ADDRESS_TYPE.delivery].includes(type)) {
    redirect(`${REDIRECT_ADDRESS_URL}`);
  }

  const session = await getSession();
  const user: any = session?.user;
  if (!user) {
    return notFound();
  }

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return notFound();
  const {client} = tenant;

  const partner = await findGooveeUserByEmail(user.email, client);

  if (!partner) {
    return notFound();
  }

  const {partnerTypeSelect} = partner;

  const userType: any = Object.entries(PartnerTypeMap).find(
    ([key, value]) => value === partnerTypeSelect,
  )?.[0];

  const countries: any = await findCountries(client).then(clone);

  const userId = getPartnerId(user);

  const partnerAddress = await findPartnerAddress({
    partnerId: userId,
    addressId: address_id,
    client,
  }).then(clone);

  if (!partnerAddress) {
    redirect(`${REDIRECT_ADDRESS_URL}`);
  }

  return (
    <Content
      type={type}
      address={partnerAddress}
      countries={countries}
      userType={userType}
    />
  );
}

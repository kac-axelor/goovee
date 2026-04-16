import {redirect} from 'next/navigation';
import {notFound} from 'next/navigation';

// ---- CORE IMPORRS ---- //
import {ADDRESS_TYPE, SUBAPP_PAGE} from '@/constants';
import {clone} from '@/utils';
import {getSession} from '@/auth';
import {workspacePathname} from '@/utils/workspace';
import {findCountries} from '@/orm/address';
import {findGooveeUserByEmail, PartnerTypeMap} from '@/orm/partner';
import {manager} from '@/lib/core/tenant';

// ---- LOCAL IMPORTS ---- //
import Content from './content';

export default async function Page(props: {params: Promise<any>}) {
  const params = await props.params;
  const {tenant: tenantId, type} = params;

  const {workspaceURI} = workspacePathname(params);

  if (![ADDRESS_TYPE.invoicing, ADDRESS_TYPE.delivery].includes(type)) {
    redirect(`${workspaceURI}/${SUBAPP_PAGE.account}/${SUBAPP_PAGE.addresses}`);
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

  return <Content type={type} countries={countries} userType={userType} />;
}

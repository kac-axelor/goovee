import {notFound} from 'next/navigation';

// ---- CORE IMPORTS ---- //
import {clone} from '@/utils';
import {t} from '@/locale/server';
import {workspacePathname} from '@/utils/workspace';
import {findWorkspace} from '@/orm/workspace';
import {getSession} from '@/auth';
import {manager} from '@/lib/core/tenant';

// ---- LOCAL IMPORTS ---- //
import ResourceForm from './form';
import {fetchFile} from '@/subapps/resources/common/orm/dms';
import {ACTION} from '@/subapps/resources/common/constants';

export default async function Page(props: {
  params: Promise<{tenant: string; workspace: string}>;
  searchParams: Promise<{id: string}>;
}) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const {tenant: tenantId} = params;
  const {id} = searchParams;

  if (!id) {
    return notFound();
  }

  const session = await getSession();

  const user = session?.user;

  if (!user) {
    return notFound();
  }

  const {workspaceURL} = workspacePathname(params);

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return notFound();
  const {client} = tenant;

  const workspace = await findWorkspace({
    user,
    url: workspaceURL,
    client,
  }).then(clone);

  if (!workspace) {
    return notFound();
  }

  const parent = await fetchFile({
    id,
    workspace,
    user,
    client,
  }).then(clone);

  if (!parent) {
    return notFound();
  }

  const {permissionSelect, isDirectory} = parent;

  const canModify =
    permissionSelect &&
    [ACTION.WRITE, ACTION.UPLOAD].includes(permissionSelect);

  if (!(isDirectory && canModify)) {
    return notFound();
  }

  return (
    <main className="container mx-auto mt-4 p-4 md:p-8 bg-white rounded space-y-2">
      <h2 className="font-semibold text-lg">{await t('Create a resource')}</h2>
      <ResourceForm parent={parent} />
    </main>
  );
}

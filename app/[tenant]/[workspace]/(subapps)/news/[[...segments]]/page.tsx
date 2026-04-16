import {notFound} from 'next/navigation';
import {Suspense} from 'react';

// ---- CORE IMPORTS ----//
import {clone} from '@/utils';
import {getSession} from '@/auth';
import {manager} from '@/tenant';
import {workspacePathname} from '@/utils/workspace';
import {findWorkspace} from '@/orm/workspace';
import {DEFAULT_PAGE} from '@/constants';

// ---- LOCAL IMPORTS ---- //
import Homepage from '@/subapps/news/[[...segments]]/homepage';
import CategoryNews from '@/subapps/news/[[...segments]]/category-news';
import ArticleNews from './article-news';
import {ArticleSkeleton} from '@/subapps/news/common/ui/components';

export default async function Page(props: {
  params: Promise<any>;
  searchParams: Promise<{[key: string]: string | undefined}>;
}) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const {tenant: tenantId} = params;

  const session = await getSession();
  const user = session?.user;
  const {workspaceURL, workspaceURI} = workspacePathname(params);

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

  const {segments} = params;
  const homepage = !segments;

  const {page = DEFAULT_PAGE} = searchParams;

  if (homepage) {
    return <Homepage workspace={workspace} client={client} />;
  }

  const slug = segments?.at(-1) || '';
  const articlePage = segments?.includes('article');

  if (articlePage) {
    return (
      <Suspense fallback={<ArticleSkeleton />}>
        <ArticleNews
          workspace={workspace}
          segments={segments}
          client={client}
          tenantId={tenantId}
          workspaceURL={workspace.url}
          workspaceURI={workspaceURI}
          user={user}
          slug={slug}
        />
      </Suspense>
    );
  }

  return (
    <CategoryNews
      workspace={workspace}
      client={client}
      page={Number(page)}
      segments={segments}
      slug={slug}
    />
  );
}

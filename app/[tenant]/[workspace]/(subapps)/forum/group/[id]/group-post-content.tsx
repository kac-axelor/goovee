// ---- CORE IMPORTS ---- //
import type {Client} from '@/goovee/.generated/client';
import type {Cloned} from '@/types/util';
import {DEFAULT_LIMIT} from '@/constants';
import {User} from '@/types';
import {PortalWorkspace} from '@/orm/workspace';
import {clone} from '@/utils';

// ---- LOCAL IMPORTS ---- //
import {findPostsByGroupId} from '@/subapps/forum/common/orm/forum';
import {ThreadList} from '@/subapps/forum/common/ui/components';

export async function GroupPostsContent({
  params,
  searchParams,
  workspace,
  memberGroupIDs,
  user,
  client,
}: {
  params: {
    id: string;
    tenant: string;
    workspace: string;
  };
  searchParams: {[key: string]: string | undefined};
  workspace: PortalWorkspace | Cloned<PortalWorkspace>;
  memberGroupIDs: string[];
  user: User;
  client: Client;
}) {
  const {sort, limit, search, searchid} = searchParams;
  const groupId = params.id as string;

  const {posts, pageInfo} = await findPostsByGroupId({
    id: groupId,
    workspaceID: workspace?.id as string,
    sort,
    limit: limit ? Number(limit) : DEFAULT_LIMIT,
    search,
    ids: searchid ? [searchid] : undefined,
    client,
    user,
    memberGroupIDs,
  }).then(clone);

  return (
    <div className="w-full mt-6">
      <ThreadList
        pageInfo={pageInfo}
        posts={posts}
        memberGroupIDs={memberGroupIDs}
        selectedGroupId={groupId}
        workspace={workspace}
      />
    </div>
  );
}

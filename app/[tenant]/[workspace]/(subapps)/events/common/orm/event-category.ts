// ---- CORE IMPORTS ---- //
import {ORDER_BY} from '@/constants';
import type {PortalWorkspace, User} from '@/types';
import {filterPrivate} from '@/orm/filter';
import {and} from '@/utils/orm';
import type {AOSPortalEventCategory} from '@/goovee/.generated/models';
import type {Client} from '@/goovee/.generated/client';

export async function findEventCategories({
  workspace,
  client,
  user,
  categoryId,
}: {
  workspace: PortalWorkspace;
  client: Client;
  user?: User;
  categoryId?: string;
}) {
  if (!workspace) return [];

  const eventCategories = await client.aOSPortalEventCategory.find({
    where: and<AOSPortalEventCategory>([
      categoryId && {id: categoryId},
      {
        workspace: {id: workspace.id},
        OR: [{archived: false}, {archived: null}],
      },
      await filterPrivate({user, client}),
    ]),
    orderBy: {name: ORDER_BY.ASC} as any,
    select: {
      id: true,
      name: true,
      color: true,
      description: true,
      image: {id: true},
      thumbnailImage: {id: true},
    },
  });

  return eventCategories;
}

export async function findEventCategory({
  id,
  client,
  workspace,
  user,
}: {
  id: string;
  client: Client;
  workspace: PortalWorkspace;
  user?: User;
}) {
  if (!workspace) return null;

  const categories = await findEventCategories({
    categoryId: id,
    workspace,
    client,
    user,
  });

  return categories?.[0] || null;
}

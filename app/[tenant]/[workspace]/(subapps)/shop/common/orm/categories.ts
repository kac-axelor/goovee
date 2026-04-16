// ---- CORE IMPORTS ---- //
import {filterPrivate} from '@/orm/filter';
import type {Client} from '@/goovee/.generated/client';
import type {PortalWorkspace, User} from '@/types';

function transform($categories: any[]) {
  const categories: any = {};

  $categories.forEach(category => {
    categories[category.id] = {
      ...category,
      parent: category.parentProductCategory,
      items: [],
    };
  });

  Object.values(categories).forEach((category: any) => {
    const {parent} = category;
    if (parent && categories[parent.id]) {
      categories[parent.id].items.push(category);
    }
  });

  return Object.values(categories);
}

export async function findCategories({
  workspace,
  client,
  user,
  archived,
}: {
  workspace: PortalWorkspace;
  client: Client;
  user?: User;
  archived?: boolean;
}) {
  if (!(workspace && client)) return [];

  const categories = await client.aOSProductCategory.find({
    where: {
      portalWorkspace: {
        id: workspace.id,
      },
      AND: [
        await filterPrivate({client, user}),
        archived
          ? {archived: true}
          : {OR: [{archived: false}, {archived: null}]},
      ],
    },
    select: {
      name: true,
      parentProductCategory: {id: true},
      slug: true,
    },
  });

  return transform(categories);
}

export async function findFeaturedCategories({
  workspace,
  client,
  user,
  archived,
}: {
  workspace: PortalWorkspace;
  client: Client;
  user?: User;
  archived?: boolean;
}) {
  if (!(workspace && client)) return [];

  const categories = await client.aOSProductCategory.find({
    where: {
      portalWorkspace: {
        id: workspace.id,
      },
      isFeatured: true,
      AND: [
        await filterPrivate({client, user}),
        archived
          ? {archived: true}
          : {OR: [{archived: false}, {archived: null}]},
      ],
    },
    select: {
      name: true,
      parentProductCategory: {id: true},
      productList: {
        where: {
          homepage: true,
        },
        orderBy: {
          featured: 'DESC',
        },
        select: {
          id: true,
        },
      },
      slug: true,
    },
  });

  return categories;
}

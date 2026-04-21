// ---- CORE IMPORTS ---- //
import {ORDER_BY, SUBAPP_CODES} from '@/constants';
import type {Client} from '@/goovee/.generated/client';
import type {AOSProject} from '@/goovee/.generated/models';
import type {ID} from '@/types';

import type {QueryProps} from './helpers';
import type {AuthProps} from '../utils/auth-helper';
import {getProjectAccessFilter} from './helpers';
import {getAllTicketCount} from './tickets';
import {
  Category,
  ClientPartner,
  Company,
  ContactPartner,
  Priority,
  Status,
} from '../types';
import {and} from '@/utils/orm';

export async function findProjects(
  props: QueryProps<AOSProject> & {auth: AuthProps},
) {
  const {where, take, orderBy, skip, auth} = props;

  const projects = await auth.tenant.client.aOSProject.find({
    ...(take ? {take} : {}),
    ...(skip ? {skip} : {}),
    ...(orderBy ? {orderBy} : {}),
    where: and<AOSProject>([getProjectAccessFilter(auth), where]),
    select: {name: true},
  });

  return projects;
}

export async function findProjectsWithTaskCount(
  props: QueryProps<AOSProject> & {auth: AuthProps},
) {
  const projects = await findProjects(props);

  const counts = await Promise.all(
    projects.map(project =>
      getAllTicketCount({projectId: project.id, auth: props.auth}),
    ),
  );

  return projects.map((p, i) => ({...p, taskCount: counts[i]}));
}

export async function findProject(id: ID, auth: AuthProps) {
  const project = await auth.tenant.client.aOSProject.findOne({
    where: {
      id: id,
      ...getProjectAccessFilter(auth),
    },
    select: {id: true, name: true},
  });

  return project;
}

export async function findTicketCategories(
  projectId: ID,
  client: Client,
): Promise<Category[]> {
  const project = await client.aOSProject.findOne({
    where: {id: projectId},
    select: {
      projectTaskCategorySet: {
        where: {OR: [{archived: false}, {archived: null}]},
        select: {id: true, name: true},
      },
    },
  });

  return project?.projectTaskCategorySet ?? [];
}

export async function findTicketPriorities(
  projectId: ID,
  client: Client,
): Promise<Priority[]> {
  const project = await client.aOSProject.findOne({
    where: {id: projectId},
    select: {
      projectTaskPrioritySet: {
        where: {OR: [{archived: false}, {archived: null}]},
        select: {id: true, name: true},
      },
    },
  });

  return project?.projectTaskPrioritySet ?? [];
}

export async function findTicketStatuses(
  projectId: ID,
  client: Client,
): Promise<Status[]> {
  const project = await client.aOSProject.findOne({
    where: {id: projectId},
    select: {
      projectTaskStatusSet: {
        where: {OR: [{archived: false}, {archived: null}]},
        orderBy: {sequence: ORDER_BY.ASC},
        select: {id: true, name: true, sequence: true, isCompleted: true},
      },
    },
  });

  return project?.projectTaskStatusSet ?? [];
}

export async function findCompany(
  projectId: ID,
  client: Client,
): Promise<Company | null | undefined> {
  const project = await client.aOSProject.findOne({
    where: {id: projectId},
    select: {company: {id: true, name: true}},
  });

  return project?.company;
}

export async function findClientPartner(
  projectId: ID,
  client: Client,
): Promise<ClientPartner | null | undefined> {
  const project = await client.aOSProject.findOne({
    where: {id: projectId},
    select: {
      clientPartner: {simpleFullName: true},
    },
  });

  return project?.clientPartner;
}

export async function findTicketDoneStatus(
  client: Client,
): Promise<string | undefined> {
  const projectAppConfig = await client.aOSAppProject.findOne({
    select: {completedTaskStatus: {id: true}},
  });

  return projectAppConfig?.completedTaskStatus?.id;
}

export async function findTicketCancelledStatus(
  client: Client,
): Promise<string | undefined> {
  const projectAppConfig = await client.aOSAppProject.findOne({
    select: {cancelledTaskStatus: {id: true}},
  });

  return projectAppConfig?.cancelledTaskStatus?.id;
}

export async function findMainPartnerContacts(
  projectId: ID,
  client: Client,
): Promise<ContactPartner[]> {
  const project = await client.aOSProject.findOne({
    where: {id: projectId},
    select: {
      clientPartner: {
        id: true,
        simpleFullName: true,
        isActivatedOnPortal: true,
        mainPartnerContacts: {
          where: {
            OR: [{archived: false}, {archived: null}],
            isActivatedOnPortal: true,
            contactWorkspaceConfigSet: {
              OR: [
                {isAdmin: true},
                {
                  contactAppPermissionList: {
                    app: {code: SUBAPP_CODES.ticketing},
                  },
                },
              ],
            },
          },
          select: {simpleFullName: true},
        },
      },
    },
  });

  if (!project?.clientPartner) return [];

  const partners =
    project.clientPartner.mainPartnerContacts?.map(p => ({
      id: p.id,
      version: p.version,
      simpleFullName: p.simpleFullName,
    })) ?? [];

  if (project.clientPartner.isActivatedOnPortal) {
    partners.push({
      id: project.clientPartner.id,
      version: project.clientPartner.version,
      simpleFullName: project.clientPartner.simpleFullName,
    });
  }

  return partners;
}

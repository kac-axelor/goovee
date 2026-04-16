'use server';

import {headers} from 'next/headers';

// ---- CORE IMPORTS ---- //
import {getSession} from '@/auth';
import {TENANT_HEADER} from '@/proxy';
import {
  findDefaultDeliveryAddress,
  findDefaultInvoicingAddress,
  findDeliveryAddresses,
  findInvoicingAddresses,
  findPartnerAddress,
} from '@/orm/address';
import type {ID} from '@/types';
import {clone, getPartnerId} from '@/utils';
import {manager} from '@/tenant';

export async function findDefaultInvoicing() {
  const session = await getSession();
  const user = session?.user;

  const tenantId = (await headers()).get(TENANT_HEADER);

  if (!(user && tenantId)) return null;

  const userId = getPartnerId(user);

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return null;
  const {client} = tenant;

  return findDefaultInvoicingAddress(userId, client).then(clone);
}

export async function findDefaultDelivery() {
  const session = await getSession();
  const user = session?.user;

  const tenantId = (await headers()).get(TENANT_HEADER);

  if (!(user && tenantId)) return null;

  const userId = getPartnerId(user);

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return null;
  const {client} = tenant;

  return findDefaultDeliveryAddress(userId, client).then(clone);
}

export async function findAddress(id: ID) {
  const session = await getSession();
  const user = session?.user;

  const tenantId = (await headers()).get(TENANT_HEADER);

  if (!(user && tenantId)) return null;

  const userId = getPartnerId(user);

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return null;
  const {client} = tenant;

  return findPartnerAddress({partnerId: userId, addressId: id, client}).then(
    clone,
  );
}

export async function fetchDeliveryAddresses() {
  const session = await getSession();
  const user = session?.user;

  const tenantId = (await headers()).get(TENANT_HEADER);

  if (!(user && tenantId)) return null;

  const userId = getPartnerId(user);

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return null;
  const {client} = tenant;

  return findDeliveryAddresses(userId, client).then(clone);
}

export async function fetchInvoicingAddresses() {
  const session = await getSession();
  const user = session?.user;

  const tenantId = (await headers()).get(TENANT_HEADER);

  if (!(user && tenantId)) return null;

  const userId = getPartnerId(user);

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return null;
  const {client} = tenant;

  return findInvoicingAddresses(userId, client).then(clone);
}

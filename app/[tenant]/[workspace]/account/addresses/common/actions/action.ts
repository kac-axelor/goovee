'use server';

import {headers} from 'next/headers';
import {z} from 'zod';

// ---- CORE IMPORTS ---- //
import {TENANT_HEADER} from '@/proxy';
import {t} from '@/locale/server';
import {ADDRESS_TYPE, SUBAPP_CODES} from '@/constants';
import {getSession} from '@/auth';
import {accessMessage} from '@/lib/core/access/denial';
import {ensureAccess} from '@/lib/core/access/ensure-access';
import {findSubappAccess} from '@/orm/workspace';
import {clone, getPartnerId} from '@/utils';
import {
  updateDefaultDeliveryAddress,
  updateDefaultInvoicingAddress,
} from '@/orm/address';
import {
  createPartnerAddress,
  updatePartnerAddress,
  deletePartnerAddress,
  assignDefaultAddress,
} from '@/orm/address';
import {AOSError} from '@/service';
import {manager} from '@/tenant';
import {
  CreateAddressSchema,
  UpdateAddressSchema,
  UpdateDefaultAddressSchema,
  ConfirmAddressesSchema,
  type CreateAddress,
  type UpdateAddress,
  type UpdateDefaultAddress,
  type ConfirmAddresses,
} from '../../../common/utils/validators';
import {IdSchema} from '@/utils/validators';

// ---- LOCAL IMPORT ---- //
import {getQuotationRecord} from '@/app/[tenant]/[workspace]/account/addresses/common/utils';

/* An optimistic-lock failure is the one AOS refusal the contact can act on: the
   address changed under them — from the back office, or from another tab — and
   reloading the page is the fix. Every other failure keeps the caller's own
   wording. */
async function addressWriteError(error: unknown, fallback: string) {
  if (error instanceof AOSError && error.isConcurrentUpdate) {
    return {
      error: true as const,
      message: await t(
        'This address was changed elsewhere. Reload the page and try again.',
      ),
    };
  }

  return {error: true as const, message: fallback};
}

export async function createAddress(data: CreateAddress) {
  const validation = CreateAddressSchema.safeParse(data);

  if (!validation.success) {
    return {error: true, message: z.prettifyError(validation.error)};
  }

  const {address, isDeliveryAddr, isInvoicingAddr, isDefaultAddr} =
    validation.data;

  if (!isDeliveryAddr && !isInvoicingAddr) {
    return {
      error: true,
      message: await t('An address must be used for invoicing or delivery.'),
    };
  }

  const session = await getSession();
  const tenantId = (await headers()).get(TENANT_HEADER);

  if (!(session && tenantId)) {
    return {error: true, message: await t('Unauthorized')};
  }

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) {
    return {error: true, message: await t('Bad request')};
  }
  const {client} = tenant;

  const userId = getPartnerId(session?.user);

  try {
    /* createPartnerAddress writes the address through AOS's REST API, which
       commits in AOS's own transaction: a database transaction here would not
       cover it, and rolling back would leave the address behind. What stays
       outside the write, and what a partial failure leaves, is documented
       there. */
    const partnerAddress = await createPartnerAddress(
      userId,
      {address, isDeliveryAddr, isInvoicingAddr, isDefaultAddr},
      client,
      tenant.config.aos,
    ).then(clone);

    return {success: true, data: partnerAddress};
  } catch (error) {
    console.error('Create address error >>>', error);
    return addressWriteError(error, await t('Error creating address'));
  }
}

export async function updateAddress(data: UpdateAddress) {
  const validation = UpdateAddressSchema.safeParse(data);

  if (!validation.success) {
    return {error: true, message: z.prettifyError(validation.error)};
  }

  const {id, version, address, isDeliveryAddr, isInvoicingAddr, isDefaultAddr} =
    validation.data;

  if (!isDeliveryAddr && !isInvoicingAddr) {
    return {
      error: true,
      message: await t('An address must be used for invoicing or delivery.'),
    };
  }

  const session = await getSession();
  const tenantId = (await headers()).get(TENANT_HEADER);

  if (!(session && tenantId)) {
    return {error: true, message: await t('Unauthorized')};
  }

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) {
    return {error: true, message: await t('Bad request')};
  }
  const {client} = tenant;

  const userId = getPartnerId(session?.user);

  try {
    /* See createAddress: the address write commits in AOS, outside any
       database transaction this action could open. */
    const partnerAddress = await updatePartnerAddress(
      userId,
      {
        id,
        version,
        address,
        isDeliveryAddr,
        isInvoicingAddr,
        isDefaultAddr,
      },
      client,
      tenant.config.aos,
    ).then(clone);

    return {success: true, data: partnerAddress};
  } catch (error) {
    console.error('Update address error >>>', error);
    return addressWriteError(error, await t('Error updating address'));
  }
}

export async function updateDefaultAddress(data: UpdateDefaultAddress) {
  const validation = UpdateDefaultAddressSchema.safeParse(data);

  if (!validation.success) {
    return null;
  }

  const {type, id, isDefault} = validation.data;

  const session = await getSession();
  const tenantId = (await headers()).get(TENANT_HEADER);

  if (!(session && tenantId)) return null;

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) return null;
  const {client} = tenant;

  const updateHandler =
    type === ADDRESS_TYPE.delivery
      ? updateDefaultDeliveryAddress
      : updateDefaultInvoicingAddress;

  const userId = getPartnerId(session?.user);

  /* updateDefault*Address does multiple writes (unset old default + set new
     default + partner fiscal update), so we wrap in a transaction. */
  return client
    .$transaction(txClient =>
      updateHandler({
        partnerAddressId: id,
        partnerId: userId,
        client: txClient,
        isDefault,
      }),
    )
    .then(clone);
}

export async function deleteAddress(data: z.infer<typeof IdSchema>) {
  const validation = IdSchema.safeParse(data);

  if (!validation.success) {
    return {error: true, message: z.prettifyError(validation.error)};
  }

  const id = validation.data;

  const session = await getSession();
  const tenantId = (await headers()).get(TENANT_HEADER);

  if (!(session?.user && tenantId)) {
    return {error: true, message: await t('Unauthorized')};
  }

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) {
    return {error: true, message: await t('Bad request')};
  }
  const {client} = tenant;

  const {user} = session;
  const userId = getPartnerId(user);

  try {
    const address = await deletePartnerAddress(userId, id, client).then(clone);
    return {success: true, data: address};
  } catch (error) {
    console.error('Delete address error >>>', error);
    return {
      error: true,
      message: await t('Error deleting address'),
    };
  }
}

const AssignAddressDefaultSchema = z.object({
  id: IdSchema,
  kind: z.enum(['invoicing', 'delivery']),
});

export async function assignAddressDefault(
  data: z.infer<typeof AssignAddressDefaultSchema>,
) {
  const validation = AssignAddressDefaultSchema.safeParse(data);

  if (!validation.success) {
    return {error: true, message: z.prettifyError(validation.error)};
  }

  const {id, kind} = validation.data;

  const session = await getSession();
  const tenantId = (await headers()).get(TENANT_HEADER);

  if (!(session?.user && tenantId)) {
    return {error: true, message: await t('Unauthorized')};
  }

  const tenant = await manager.getTenant(tenantId);
  if (!tenant) {
    return {error: true, message: await t('Bad request')};
  }
  const {client} = tenant;

  const userId = getPartnerId(session.user);

  try {
    /* assignDefaultAddress does multiple writes (mark the address as the
       delivery/invoicing type + unset the previous default + set the new
       default + partner fiscal update), so we wrap it in a transaction to keep
       them atomic — mirroring updateDefaultAddress. */
    const result = await client
      .$transaction(txClient =>
        assignDefaultAddress({
          partnerId: userId,
          partnerAddressId: id,
          kind,
          client: txClient,
        }),
      )
      .then(clone);

    if (!result) {
      return {error: true, message: await t('Error updating default address')};
    }

    return {success: true, data: result};
  } catch (error) {
    console.error('Assign default address error >>>', error);
    return {error: true, message: await t('Error updating default address')};
  }
}

export async function confirmAddresses(data: ConfirmAddresses) {
  const validation = ConfirmAddressesSchema.safeParse(data);

  if (!validation.success) {
    return {
      error: true,
      message: z.prettifyError(validation.error),
    };
  }

  const {record, subAppCode} = validation.data;

  const access = await ensureAccess();

  if (!access.ok) {
    return {error: true, message: await accessMessage(access.reason)};
  }

  const {user, workspace, tenant} = access;
  const {client} = tenant;
  const workspaceURL = workspace.url;

  const subapp = await findSubappAccess({
    code: subAppCode,
    user,
    url: workspace.url,
    client,
  });

  if (!subapp) {
    return {
      error: true,
      message: await t('Unauthorized'),
    };
  }

  let modelRecord;

  if (subAppCode === SUBAPP_CODES.quotations) {
    const response = await getQuotationRecord({
      id: record.id,
      user,
      client,
      workspaceURL,
      subapp,
    });

    if (!response) {
      return {
        error: true,
        message: await t('Record not found.'),
      };
    }
    modelRecord = response;
  }

  try {
    const reqBody = {
      id: record.id,
      version: Number(modelRecord?.version),
      mainInvoicingAddressStr: record.mainInvoicingAddress.formattedFullName,
      mainInvoicingAddress: {
        select: {
          id: record.mainInvoicingAddress.id,
        },
      },
      deliveryAddressStr: record.deliveryAddress.formattedFullName,
      deliveryAddress: {
        select: {
          id: record.deliveryAddress.id,
        },
      },
    };

    const result = await client.aOSOrder
      .update({data: reqBody, select: {id: true}})
      .then(clone)
      .catch(error => {
        console.error('Update error >>>', error);
      });

    return {success: true, data: result};
  } catch (error) {
    console.error('Confirm Address error >>>', error);
    return {
      error: true,
      message: await t('Something went wrong while saving address!'),
    };
  }
}

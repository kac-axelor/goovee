// ---- CORE IMPORTS ---- //
import type {Client} from '@/goovee/.generated/client';
import {clone} from '@/utils';

export async function findModelRecord({
  recordId,
  client,
}: {
  recordId: string;
  client: Client;
}) {
  if (!client) {
    return [];
  }

  const record = await client.aOSMetaJsonRecord
    .findOne({
      where: {id: recordId},
    })
    .then(clone);

  return record;
}

export async function findModelRecords({
  recordIds,
  client,
}: {
  recordIds: string[];
  client: Client;
}) {
  if (!client) {
    return [];
  }

  const record = await client.aOSMetaJsonRecord
    .find({
      where: {
        id: {
          in: recordIds,
        },
      },
    })
    .then(clone);

  return record;
}

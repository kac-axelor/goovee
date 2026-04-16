// ---- CORE IMPORTS ---- //
import type {Client} from '@/goovee/.generated/client';
import {clone} from '@/utils';

export async function findModelFields({
  modelName,
  jsonModelName,
  modelField,
  client,
  fieldName,
}: {
  modelName?: string;
  jsonModelName?: string;
  modelField: string;
  client: Client;
  fieldName?: string;
}) {
  const fields = await client.aOSMetaJsonField
    .find({
      where: {
        modelField,
        showIf: null,
        ...(modelName && {model: modelName}),
        ...(jsonModelName && {jsonModel: {name: jsonModelName}}),
        ...(fieldName && {name: fieldName}),
        OR: [{hidden: false}, {hidden: null}],
      },
      orderBy: {sequence: 'ASC'},
      select: {
        columnSequence: true,
        name: true,
        title: true,
        type: true,
        defaultValue: true,
        model: true,
        modelField: true,
        selection: true,
        widget: true,
        help: true,
        hidden: true,
        required: true,
        readonly: true,
        nameField: true,
        minSize: true,
        maxSize: true,
        precision: true,
        scale: true,
        sequence: true,
        regex: true,
        showIf: true,
        contextField: true,
        contextFieldValue: true,
        widgetAttrs: true,
        createdOn: true,
        updatedOn: true,
        targetJsonModel: {name: true},
        jsonModel: {name: true},
        targetModel: true,
      },
    })
    .then(clone);

  const result = [];

  for (const _f of fields) {
    if (_f.selection != null) {
      const options = await findSelectionItems({
        selectionName: _f.selection,
        client,
      });
      result.push({..._f, selectionOptions: options});
    } else {
      result.push(_f);
    }
  }

  return result;
}

export async function findSelectionItems({
  selectionName,
  client,
}: {
  selectionName: string;
  client: Client;
}) {
  const options = await client.aOSMetaSelectItem.find({
    where: {
      select: {name: {eq: selectionName}},
    },
    select: {color: true, icon: true, order: true, title: true, value: true},
  });

  return options;
}

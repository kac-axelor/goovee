'use client';

import React, {useCallback, useState} from 'react';
import {UseFormReturn} from 'react-hook-form';

import {type Column, GridView, selectRecord} from '@/ui/grid';

import type {Field as FieldType, Panel} from '../types';

export const FormGridComponent = ({
  form,
  item,
  identifier,
  readonly = false,
  config,
}: {
  form: UseFormReturn<Record<string, any>>;
  item: FieldType;
  identifier: string;
  readonly?: boolean;
  config?: {
    columns: Partial<Column>[];
    fields: FieldType[];
    panels?: Panel[];
    data?: any[];
  };
}) => {
  const {columns, fields, panels, data} = config ?? {};

  const [selectedRows, setSelectedRows] = useState<any[]>([]);

  const handleSelect = useCallback(
    (records: any) => {
      const _current = form.getValues(identifier) ?? [];

      form.setValue(
        identifier,
        [..._current, ...records].filter(
          (_i, idx, self) =>
            self.findIndex(({id}: any) => id === _i.id) === idx,
        ),
      );
    },
    [form, identifier],
  );

  const handleRowSelection = useCallback((record: any) => {
    setSelectedRows(_current => selectRecord(_current, record));
  }, []);

  const handleRemove = useCallback(() => {
    const _current: any[] = form.getValues(identifier) ?? [];

    form.setValue(
      identifier,
      _current.filter(_i => !selectedRows.find(({id}: any) => _i.id === id)),
    );

    setSelectedRows([]);
  }, [form, identifier, selectedRows]);

  const handleAddition = useCallback(
    (data: any) => {
      const _current = form.getValues(identifier) ?? [];

      form.setValue(identifier, [
        ..._current,
        {id: `id-${Date.now()}`, ...data},
      ]);
    },
    [form, identifier],
  );

  return (
    <GridView
      title={item.title}
      style={{margin: 0, padding: 0}}
      columns={columns ?? []}
      data={form.getValues(identifier) ?? []}
      handleRowClick={handleRowSelection}
      creationContent={
        fields ? {fields, panels, handleCreate: handleAddition} : undefined
      }
      selectionContent={data ? {data, handleSelect} : undefined}
      canCreate={!readonly}
      canSelect={!readonly}
      selectedRows={readonly ? undefined : selectedRows.map(({id}: any) => id)}
      canRemove={!readonly}
      handleRemove={handleRemove}
    />
  );
};

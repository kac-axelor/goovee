'use client';

import React, {useCallback, useMemo} from 'react';
import type {UseFormReturn} from 'react-hook-form';

import {i18n} from '@/locale';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components';

import type {Field} from '../types';

export const ObjectPicker = ({
  form,
  field,
  formKey,
  readonly = false,
  data,
  targetName,
}: {
  form: UseFormReturn<Record<string, any>>;
  field: Field;
  formKey: string;
  readonly?: boolean;
  data?: any[];
  targetName?: string;
}) => {
  const options = useMemo(
    () => data?.map(_o => ({..._o, label: _o[targetName ?? 'name']})) ?? [],
    [data, targetName],
  );

  const handleSelect = useCallback(
    (value: string) => {
      form.setValue(
        formKey,
        options.find(({id}: any) => id === parseInt(value, 10)),
        {shouldValidate: true},
      );
    },
    [form, formKey, options],
  );

  const formValue = form.watch(formKey)?.id?.toString();

  return (
    <Select
      value={formValue}
      onValueChange={handleSelect}
      disabled={readonly}
      required={field.required}>
      <SelectTrigger className="w-full rounded-lg focus-visible:ring-offset-0 focus-visible:ring-0 text-main-black dark:text-white placeholder:text-sm placeholder:font-normal h-[2.875rem] border text-sm font-normal">
        <SelectValue placeholder={i18n.t('Select')} />
      </SelectTrigger>
      <SelectContent>
        {options?.length === 0 ? (
          <p className="text-center">{i18n.t('No result')}</p>
        ) : (
          options.map((_i: any) => (
            <SelectItem value={_i.id.toString()} key={_i.id}>
              {_i.label}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
};

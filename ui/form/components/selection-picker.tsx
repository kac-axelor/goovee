'use client';

import React, {useCallback, useMemo} from 'react';
import type {UseFormReturn} from 'react-hook-form';
import {LuCheck} from 'react-icons/lu';

import {i18n} from '@/locale';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/ui/components';

import type {Field} from '../types';

export const SelectionPicker = ({
  form,
  field,
  formKey,
  readonly = false,
  itemSet,
  isMulti = false,
  isInteger = false,
}: {
  form: UseFormReturn<Record<string, any>>;
  field: Field;
  formKey: string;
  readonly?: boolean;
  itemSet?: any[];
  isMulti?: boolean;
  isInteger?: boolean;
}) => {
  const options = useMemo(
    () => itemSet?.map(_o => ({..._o, label: _o.title})) ?? [],
    [itemSet],
  );

  const isSelected = useCallback(
    (value: string, _current: string[]) => _current.includes(value),
    [],
  );

  const handleSelect = useCallback(
    (value: string, _current: string[]) => {
      if (value?.length > 0) {
        const _value = value.replace('-', '');

        if (isInteger) {
          form.setValue(formKey, parseInt(_value), {shouldValidate: true});
          return;
        }

        const _next = _current.includes(_value)
          ? _current.filter((_v: string) => _v !== _value)
          : [...(isMulti ? _current : []), _value];

        form.setValue(formKey, _next.length > 0 ? _next.join(',') : undefined, {
          shouldValidate: true,
        });
      }
    },
    [form, formKey, isInteger, isMulti],
  );

  const formValue = '' + form.watch(formKey);
  const selectedItems = formValue?.split(',') ?? [];

  return (
    <Select
      value={formValue}
      onValueChange={_v => handleSelect(_v, selectedItems)}
      disabled={readonly}
      required={field.required}>
      <SelectTrigger className="w-full rounded-lg focus-visible:ring-offset-0 focus-visible:ring-0 text-main-black dark:text-white placeholder:text-sm placeholder:font-normal h-[2.875rem] border text-sm font-normal">
        <div className="truncate">
          {selectedItems?.length > 0
            ? selectedItems
                .map((v: string) => options.find(_i => _i.value === v)?.label)
                .join(', ')
            : i18n.t('Select an option...')}
        </div>
      </SelectTrigger>
      <SelectContent>
        {options.map(item => {
          const _value = item.value;
          const isItemSelected = isSelected(_value, selectedItems);

          return (
            <SelectItem
              key={_value}
              value={`-${_value}`}
              displaySelected={false}>
              {isItemSelected && (
                <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                  <LuCheck className="h-4 w-4" />
                </span>
              )}
              {item.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};

'use client';

import React, {useCallback, useEffect, useMemo} from 'react';
import {UseFormReturn} from 'react-hook-form';
import {ZodSchema} from 'zod';

import type {Field, DisplayPanel} from '../types';
import {FieldComponent, PanelComponent} from '../components';
import {createFormSchema} from '../validation.helpers';
import {getFormContent} from '../content.helpers';
import {isField} from '../display.helpers';

import {formatStudioContent} from './display.helpers';

export const CustomFieldsViewer = ({
  metaFields,
  context,
  form,
  concatSchema,
  isReadonly = false,
}: {
  metaFields: any[];
  context?: any;
  form: UseFormReturn<Record<string, any>>;
  concatSchema?: (customSchema: ZodSchema) => void;
  isReadonly?: boolean;
}) => {
  const {fields, panels} = useMemo(
    () => formatStudioContent(metaFields, context),
    [context, metaFields],
  );

  const formContent = useMemo(
    () => getFormContent(fields, panels),
    [fields, panels],
  );

  const formSchema = useMemo(() => createFormSchema(fields), [fields]);

  useEffect(() => {
    if (formSchema) {
      concatSchema?.(formSchema);
    }
  }, [concatSchema, formSchema]);

  const renderItem = useCallback(
    (item: DisplayPanel | Field, name: string) => {
      if (isField(item)) {
        return (
          <FieldComponent
            key={name}
            item={item as Field}
            identifier={name}
            form={form}
            globalReadonly={isReadonly}
            renderItem={renderItem}
          />
        );
      }

      return (
        <PanelComponent
          key={name}
          item={item as DisplayPanel}
          renderItem={renderItem}
        />
      );
    },
    [form, isReadonly],
  );

  return formContent.map(_i => renderItem(_i, _i.name));
};

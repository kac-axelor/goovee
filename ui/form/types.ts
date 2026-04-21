import {UseFormReturn} from 'react-hook-form';

export const DEFAULT_COLSPAN = 12;

interface BasicItem {
  name: string;
  order?: number;
  title?: string;
  parent?: string;
  colSpan?: number;
}

export interface customComponentOptions {
  style?: any;
  field: Field;
  form: UseFormReturn<Record<string, any>>;
  formKey: string;
  readonly?: boolean;
  renderItem?: (item: any, name: string) => React.JSX.Element;
}

export interface Field extends BasicItem {
  helper?: string;
  type: InputType;
  hidden?: boolean;
  hideIf?: (formState: any) => boolean;
  requiredIf?: (formState: any) => boolean;
  required?: boolean;
  readonly?: boolean;
  widget?: WidgetType;
  customComponent?: (options: customComponentOptions) => React.JSX.Element;
  options?: {[key: string]: any};
  validationOptions?: {
    [key: string]: {
      value?: any;
      customErrorKey?: string;
    };
  };
  subSchema?: Field[];
}

export interface Panel extends BasicItem {}

export interface DisplayPanel extends Panel {
  content: (DisplayPanel | Field)[];
}

export enum InputType {
  ornament = 'ornament',
  string = 'string',
  number = 'number',
  boolean = 'boolean',
  array = 'array',
  object = 'object',
}

export enum WidgetType {
  default = 'default',
  email = 'email',
  url = 'url',
  phone = 'phone',
  html = 'html',
  checkbox = 'checkbox',
  select = 'select',
  custom = 'custom',
}

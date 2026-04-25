'use client';
import DOMPurify from 'dompurify';
import {
  type ComponentProps,
  type ElementType,
  type HTMLAttributes,
  type Ref,
} from 'react';

import type {Maybe} from '@/types/util';

export type InnerHTMLProps<T extends ElementType = 'div'> = {
  content: Maybe<string>;
  as?: T;
} & Omit<ComponentProps<T>, 'children' | 'dangerouslySetInnerHTML' | 'as'>;

type HTMLElementProps = HTMLAttributes<HTMLElement> & {ref?: Ref<HTMLElement>};

export function InnerHTML<T extends ElementType = 'div'>({
  content,
  as: Tag = 'div' as T,
  ...rest
}: InnerHTMLProps<T>) {
  const Component = Tag as ElementType<HTMLElementProps>;
  return (
    <Component
      {...rest}
      dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(content || '')}}
    />
  );
}

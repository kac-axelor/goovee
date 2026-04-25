import {ORDER_BY} from '@/constants';
import {parseJSON} from 'date-fns';
import {get} from 'lodash-es';
import {useCallback, useMemo, useState} from 'react';

function sortDate(a: string | Date, b: string | Date) {
  a = new Date(a);
  b = new Date(b);
  return sortNumber(a.valueOf(), b.valueOf());
}

function sortNumber(a: number, b: number) {
  if (isNaN(a) && isNaN(b)) return 0;
  if (isNaN(a)) return 1;
  if (isNaN(b)) return -1;
  return a - b;
}

function genericSort<T extends string | number | Date>(a: T, b: T) {
  // we assume if a and b are of same type
  if (
    (typeof a === 'number' && typeof b === 'number') ||
    (!isNaN(Number(a)) && !isNaN(Number(b))) // this prevents things like "12" to be parsed as date since they get matched here as number instead
  ) {
    //NOTE: This sorts numbers, strings that can be parsed to number and date objects (Number(Date) is same as Date.valueOf())
    return sortNumber(Number(a), Number(b));
  }
  if (typeof a === 'string' && typeof b === 'string') {
    // attempt to convert to date
    // string like "12" would already be handled as number above
    const dateA = parseJSON(a).valueOf();
    const dateB = parseJSON(b).valueOf();
    if (isNaN(dateA) || isNaN(dateB)) {
      // if not convertable to date then they are regular string,
      return a.localeCompare(b);
    }
    // at both value converts to date , we sort by date.
    return sortDate(a, b);
  }

  if (a instanceof Date && b instanceof Date) {
    //NOTE: Date object sorting is handled in number section, this executes only if one of the date is invalid
    return sortDate(a, b);
  }
  // ideally this should never execute
  return 0;
}

export type SortType =
  | 'number'
  | 'string'
  | 'json-date'
  | 'string-number'
  | 'date';

export type ToggleSortProps<T extends Record<string, any>> = {
  key: string | null;
  getter?: string | ((record: T) => unknown);
  type?: SortType;
};

export type Sort<T extends Record<string, any>> = ToggleSortProps<T> & {
  direction: 'ASC' | 'DESC';
};

export function useSortBy<T extends Record<string, any>>(items: T[]) {
  const [sort, setSort] = useState<Sort<T>>({
    key: null,
    direction: ORDER_BY.ASC,
  });

  const toggleSort = useCallback(({key, getter, type}: ToggleSortProps<T>) => {
    setSort(sort => {
      return {
        key,
        getter,
        type,
        direction:
          sort.key !== key
            ? ORDER_BY.ASC
            : sort.direction === ORDER_BY.DESC
              ? ORDER_BY.ASC
              : ORDER_BY.DESC,
      };
    });
  }, []);

  const sortedItems = useMemo(() => {
    if (!sort.key) return items;
    const isDesc = sort.direction === ORDER_BY.DESC;
    const sortedItems = items.toSorted((a: any, b: any): number => {
      if (isDesc) [a, b] = [b, a];

      if (typeof sort.getter === 'function') {
        a = sort.getter(a);
        b = sort.getter(b);
      }

      if (typeof sort.getter === 'string') {
        a = get(a, sort.getter);
        b = get(b, sort.getter);
      }

      // handle null | undefined
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;

      if (!sort.type) {
        return genericSort(a, b);
      }

      switch (sort.type) {
        case 'string':
          return a.localeCompare(b);
        case 'number':
        case 'string-number':
          return sortNumber(Number(a), Number(b));
        case 'date':
        case 'json-date':
          return sortDate(a, b);
      }
    });

    return sortedItems;
  }, [items, sort]);

  return useMemo(
    () => [sortedItems, sort, toggleSort] as const,
    [sortedItems, sort, toggleSort],
  );
}

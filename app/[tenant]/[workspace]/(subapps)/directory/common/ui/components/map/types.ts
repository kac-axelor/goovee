import {Cloned} from '@/types/util';
import {Entry, ListEntry} from '../../../types';

export type MapContentProps = {
  className: string;
  center: {lat: number; lng: number};
  zoom: number;
  items: Cloned<Entry>[] | Cloned<ListEntry>[];
  small: boolean;
  apiKey?: string | null;
};

import {capitalize, startCase} from 'lodash-es';

export function toTitleCase(name: string): string;
export function toTitleCase(name: string, allUpper: boolean): string;
export function toTitleCase(name: string, allUpper = false) {
  const res = startCase(name);
  return allUpper ? res : capitalize(res);
}

export function getInitials(fullName?: string) {
  if (!fullName) return '';

  const nameParts = fullName.split(' ');

  const firstInitial = nameParts[0].charAt(0).toUpperCase();
  const lastInitial = nameParts[nameParts.length - 1].charAt(0).toUpperCase();

  const initials = firstInitial + lastInitial;

  return initials;
}

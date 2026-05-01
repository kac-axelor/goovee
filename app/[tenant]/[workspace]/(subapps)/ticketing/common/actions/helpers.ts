import type {ErrorResponse} from '@/types/action';
import {VERSION_MISMATCH_ERROR} from '../constants';

export function handleError(e: unknown): ErrorResponse {
  console.log(e);
  if (e instanceof Error) {
    if (e.name === VERSION_MISMATCH_ERROR) {
      return {error: true, message: e.name};
    }
    return {error: true, message: e.message};
  }
  throw e;
}

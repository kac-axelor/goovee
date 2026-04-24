import {z} from 'zod';

export const IdSchema = z
  .string()
  .regex(/^\d+$/) // digits only
  .max(19); // PostgreSQL BIGINT limit

export const OTPSchema = z
  .string()
  .regex(/^\d{6}$/, 'OTP must be a 6-digit number');

export const PasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters');

export const TenantIdSchema = z.string().min(1, 'Tenant ID is required');

/* TODO: z.httpUrl() is too strict and does not allow urls without actual domain like http://localhost:3000, http://192.168.1.10:3000
 * https://github.com/colinhacks/zod/issues/5577
 * We should set a env to indicate if we are in production or not and use z.url() or z.httpUrl() accordingly
 */
export const WorkspaceURLSchema = z.url({protocol: /^https?$/});

export const RoleSelectSchema = z.enum(['restricted', 'total']);

export type RoleSelect = z.infer<typeof RoleSelectSchema>;

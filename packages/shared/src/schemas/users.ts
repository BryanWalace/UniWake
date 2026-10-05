import { z } from 'zod';
import { LIMITS } from './common';

export const ROLES = ['admin', 'operator'] as const;
export type Role = (typeof ROLES)[number];

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(LIMITS.usernameMin, `Mínimo de ${LIMITS.usernameMin} caracteres.`)
  .max(LIMITS.usernameMax, `Máximo de ${LIMITS.usernameMax} caracteres.`)
  .regex(/^[a-z0-9._-]+$/, 'Use apenas letras minúsculas, números, ponto, hífen ou sublinhado.');

/** Length rules only; the common-password check runs on the server (FR-006.3). */
export const passwordSchema = z
  .string()
  .min(LIMITS.passwordMin, `A senha precisa de pelo menos ${LIMITS.passwordMin} caracteres.`)
  .max(LIMITS.passwordMax, `Máximo de ${LIMITS.passwordMax} caracteres.`);

export const setupSchema = z.object({ username: usernameSchema, password: passwordSchema });
export type SetupInput = z.input<typeof setupSchema>;

export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(LIMITS.usernameMax),
  password: z.string().min(1).max(LIMITS.passwordMax),
});
export type LoginInput = z.input<typeof loginSchema>;

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(LIMITS.passwordMax),
  newPassword: passwordSchema,
});

export const userCreateSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(ROLES),
});
export const userUpdateSchema = z.object({
  role: z.enum(ROLES).optional(),
  enabled: z.boolean().optional(),
});
export const passwordResetSchema = z.object({ newPassword: passwordSchema });
export type UserCreate = z.input<typeof userCreateSchema>;
export type UserUpdate = z.input<typeof userUpdateSchema>;

export interface User {
  id: number;
  username: string;
  role: Role;
  enabled: boolean;
  createdAt: number;
  passwordChangedAt: number;
}

export interface Me {
  id: number;
  username: string;
  role: Role;
}

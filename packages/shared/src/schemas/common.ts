/**
 * Common field schemas and limits (spec §8, ADR-016). Every string has a max length.
 */
import { z } from 'zod';

export const LIMITS = {
  name: 64,
  tagName: 32,
  hostname: 253,
  notes: 1000,
  usernameMin: 3,
  usernameMax: 32,
  passwordMin: 10,
  passwordMax: 128,
  block: 64,
  floor: 32,
  pageSizeMax: 200,
  compactListMax: 2000,
} as const;

/** Trimmed, required text of 1..max chars. */
export const requiredText = (max: number) =>
  z.string().trim().min(1, 'Campo obrigatório.').max(max, `Máximo de ${max} caracteres.`);

/** Trimmed optional text; empty string becomes null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres.`)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();

export const nameSchema = requiredText(LIMITS.name);
export const notesSchema = optionalText(LIMITS.notes);

export const ipv4Schema = z.ipv4({ error: 'IP inválido. Use o formato 10.0.0.15.' });

/** Optional IPv4: empty string or null → null. */
export const optionalIpv4Schema = z
  .union([z.literal(''), ipv4Schema])
  .transform((s) => (s === '' ? null : s))
  .nullable()
  .optional();

/**
 * Host names: DNS charset (letters, digits, hyphen, dot) plus underscore, which Windows NetBIOS
 * names may contain. Labels 1..63 chars, total ≤ 253.
 */
export const hostnameSchema = z
  .string()
  .trim()
  .max(LIMITS.hostname, `Máximo de ${LIMITS.hostname} caracteres.`)
  .regex(
    /^(?=.{1,253}$)[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?(?:\.[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?)*$/,
    'Nome de host inválido.',
  );

export const optionalHostnameSchema = z
  .union([z.literal(''), hostnameSchema])
  .transform((s) => (s === '' ? null : s))
  .nullable()
  .optional();

export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida. Use o formato #RRGGBB.')
  .transform((s) => s.toLowerCase());

export const idSchema = z.number().int().positive();
export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(50),
});

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

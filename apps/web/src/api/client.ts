/**
 * Typed API client. Every error from the hub is `{ code, message, details }` (ADR-006); the
 * message is already pt-BR and can be shown to the operator as-is.
 */
import type { ApiError, ErrorCode } from '@uniwake/shared';
import { IDLE_HEADER, isUserIdle } from '../lib/activity';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export const NETWORK_ERROR_MESSAGE =
  'Não foi possível falar com o serviço UniWake. Verifique se ele está em execução e tente de novo.';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}

function isApiError(x: unknown): x is ApiError {
  return typeof x === 'object' && x !== null && 'code' in x && 'message' in x;
}

export async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(isUserIdle() ? { [IDLE_HEADER]: '1' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiRequestError(0, 'NETWORK_ERROR', NETWORK_ERROR_MESSAGE);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }
  if (!res.ok) {
    if (isApiError(data))
      throw new ApiRequestError(res.status, data.code, data.message, data.details);
    throw new ApiRequestError(res.status, 'INTERNAL_ERROR', NETWORK_ERROR_MESSAGE);
  }
  return data as T;
}

async function failure(res: Response): Promise<never> {
  let data: unknown;
  try {
    data = JSON.parse(await res.text());
  } catch {
    data = undefined;
  }
  if (isApiError(data))
    throw new ApiRequestError(res.status, data.code, data.message, data.details);
  throw new ApiRequestError(res.status, 'INTERNAL_ERROR', NETWORK_ERROR_MESSAGE);
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', NETWORK_ERROR_MESSAGE);
  }
}

/** Uploads a file as the raw request body (v1.4 import, F11-01). */
export async function postFile<T>(path: string, file: Blob): Promise<T> {
  const res = await send(path, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) return failure(res);
  return (await res.json()) as T;
}

/** POSTs JSON and receives a file (v1.4 export): the bytes and the name the hub chose. */
export async function postForFile(
  path: string,
  body: unknown,
): Promise<{ blob: Blob; fileName: string }> {
  const res = await send(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return failure(res);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  return { blob: await res.blob(), fileName: name ?? 'UniWake.uniwake' };
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('POST', path, body ?? {}, opts),
  patch: <T>(path: string, body: unknown, opts?: RequestOptions) =>
    request<T>('PATCH', path, body, opts),
  del: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts),
};

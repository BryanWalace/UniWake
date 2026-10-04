/**
 * Dashboard and uptime DTOs (FR-004.5, FR-004.6; plan §6.1, §6.3).
 */
import { z } from 'zod';
import type { JobState } from './wake';

export interface StatusCounts {
  online: number;
  offline: number;
  desconhecido: number;
  total: number;
}

export interface RoomCounts extends StatusCounts {
  /** null = "Sem sala". */
  roomId: number | null;
}

/** Payload of the SSE `counters` event and part of GET /api/dashboard. */
export interface Counters {
  global: StatusCounts;
  rooms: RoomCounts[];
}

/** The latest wake job that touched a room, counted over that room's devices only. */
export interface RoomLastAction {
  jobId: number;
  source: 'manual' | 'schedule' | 'test';
  state: JobState;
  dryRun: boolean;
  at: number;
  total: number;
  woke: number;
  alreadyOn: number;
  noResponse: number;
  sendFailed: number;
}

export interface DashboardRoom {
  id: number;
  name: string;
  code: string;
  block: string | null;
  floor: string | null;
  color: string;
  counts: StatusCounts;
  lastAction: RoomLastAction | null;
}

export interface DashboardTag {
  id: number;
  name: string;
  color: string;
  total: number;
}

export interface DashboardNotice {
  id: number;
  type: string;
  createdAt: number;
  data: Record<string, unknown>;
}

export interface Dashboard {
  counters: StatusCounts;
  /** Ordered by block → floor → name (natural order, empty last). */
  rooms: DashboardRoom[];
  /** "Sem sala" card; null when every device has a room. */
  noRoom: StatusCounts | null;
  tags: DashboardTag[];
  notices: DashboardNotice[];
  demo: boolean;
  lastSweepAt: number | null;
}

export const UPTIME_MAX_DAYS = 366;

export const uptimeQuerySchema = z
  .object({
    deviceId: z.coerce.number().int().positive().optional(),
    roomId: z.coerce.number().int().positive().optional(),
    days: z.coerce.number().int().min(1).max(UPTIME_MAX_DAYS).default(30),
  })
  .refine((q) => (q.deviceId === undefined) !== (q.roomId === undefined), {
    message: 'Informe deviceId ou roomId.',
  });
export type UptimeQuery = z.output<typeof uptimeQuerySchema>;

export interface UptimeDay {
  /** Local day `YYYY-MM-DD` in the hub time zone. */
  day: string;
  /** Fraction 0..1 of the day online; null when the device did not exist yet. Today: so far. */
  ratio: number | null;
}

export interface UptimeSeries {
  days: UptimeDay[];
  average: number | null;
}

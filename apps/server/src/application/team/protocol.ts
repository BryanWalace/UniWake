/** Team-mode wire messages (plan §14.3). Every received message is parsed with these schemas. */
import { z } from 'zod';

const b64 = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/);
const uuid = z.string().regex(/^[0-9a-f-]{36}$/);
const name = z.string().min(1).max(64);

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------- pairing (plain TCP)
export const pairHello = z.object({
  type: z.literal('pair.hello'),
  v: z.literal(PROTOCOL_VERSION),
  instance: uuid,
  name,
  nonce: b64(64),
  /** The joiner's team port, so the inviter can pull from it. */
  port: z.number().int().min(1).max(65535).optional(),
});
export const pairStart = z.object({
  type: z.literal('pair.start'),
  instance: uuid,
  name,
  nonce: b64(64),
  pA: b64(400),
});
export const pairFinish = z.object({ type: z.literal('pair.finish'), pB: b64(400), cB: b64(64) });
export const sealedBox = z.object({ iv: b64(32), tag: b64(32), data: b64(16_384) });
export const pairConfirm = z.object({
  type: z.literal('pair.confirm'),
  cA: b64(64),
  box: sealedBox,
});
export const pairDone = z.object({ type: z.literal('pair.done') });
export const pairError = z.object({
  type: z.literal('pair.error'),
  code: z.enum(['no_code', 'wrong_code', 'locked', 'busy', 'bad_message']),
  attemptsLeft: z.number().int().min(0).max(10).optional(),
});

export const grantSchema = z.object({
  teamId: uuid,
  epoch: z.number().int().positive(),
  key: b64(64),
  prevEpoch: z.number().int().positive().nullable(),
  prevKey: b64(64).nullable(),
  memberSecret: b64(64),
});

// ---------------------------------------------------------------- sync (TLS-PSK)
export const syncHello = z.object({
  type: z.literal('hello'),
  v: z.literal(PROTOCOL_VERSION),
  instance: uuid,
  epoch: z.number().int().positive(),
  memberSecret: b64(64),
  seq: z.number().int().min(0),
});
export const rekeyMsg = z.object({
  type: z.literal('rekey'),
  epoch: z.number().int().positive(),
  key: b64(64),
});
const entity = z.enum([
  'user',
  'team_member',
  'room',
  'tag',
  'device',
  'schedule',
  'schedule_exception',
  'schedule_run',
  'setting',
  'scheduler_pause',
]);
export const changeEntry = z.object({
  seq: z.number().int().min(0),
  entity,
  entityId: z.string().min(1).max(64),
  op: z.enum(['upsert', 'delete']),
  rev: z.number().int().min(0),
  instance: z.string().min(1).max(64),
  at: z.number().int(),
  payload: z.record(z.string(), z.unknown()).nullable(),
});
export const pullMsg = z.object({ type: z.literal('pull'), since: z.number().int().min(0) });
export const changesMsg = z.object({
  type: z.literal('changes'),
  entries: z.array(changeEntry).max(200_000),
  seq: z.number().int().min(0),
});
export const pokeMsg = z.object({ type: z.literal('poke') });
/** After applying a batch: everything up to `seq` of the server's log is here now (FR-202.5/.6). */
export const ackMsg = z.object({ type: z.literal('ack'), seq: z.number().int().min(0) });
export const byeMsg = z.object({ type: z.literal('bye') });
export const errorMsg = z.object({ type: z.literal('error'), code: z.string().max(40) });
export const sessionRequest = z.discriminatedUnion('type', [
  pullMsg,
  ackMsg,
  pokeMsg,
  byeMsg,
  rekeyMsg,
]);

// ---------------------------------------------------------------- discovery (UDP)
export const announcement = z.object({
  app: z.literal('uniwake'),
  v: z.literal(PROTOCOL_VERSION),
  instance: uuid,
  port: z.number().int().min(1).max(65535),
  /** Hash of the team id (FR-202.1); absent while this PC is not in a team. */
  team: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
  seq: z.number().int().min(0),
  /** Only while a pairing code is open. */
  pairing: z.object({ name }).optional(),
});
export type Announcement = z.infer<typeof announcement>;

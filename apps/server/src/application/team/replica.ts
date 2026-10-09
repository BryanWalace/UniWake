/**
 * What team mode needs from the local data (plan §14): the change log as a feed, the apply engine
 * and the joiner's replacement. Implemented by `db/sync` (the application never imports `db`).
 */
export type ReplicatedEntity =
  | 'user'
  | 'team_member'
  | 'room'
  | 'tag'
  | 'device'
  | 'schedule'
  | 'schedule_exception'
  | 'schedule_run'
  | 'setting'
  | 'scheduler_pause';

export interface ChangeEntry {
  seq: number;
  entity: ReplicatedEntity;
  entityId: string;
  op: 'upsert' | 'delete';
  rev: number;
  instance: string;
  at: number;
  payload: Record<string, unknown> | null;
}

export type ConflictKind = 'concurrent' | 'duplicate_mac' | 'duplicate_name';

export interface ConflictRecord {
  entity: ReplicatedEntity;
  entityId: string;
  label: string;
  kind: ConflictKind;
  kept: unknown;
  discarded: unknown;
  winnerInstance: string | null;
}

export interface ApplyOptions {
  now: number;
  /** The peer's cursor into our log: our versions after it were unseen by them (concurrency). */
  peerAckedSeq?: number;
  /** The peer the batch came from (its own earlier versions are never a conflict). */
  peerInstance?: string;
}

export interface ApplyResult {
  applied: number;
  skipped: number;
  conflicts: ConflictRecord[];
  touched: Set<ReplicatedEntity>;
}

export interface ReplicaStore {
  changesSince(seq: number): { entries: ChangeEntry[]; seq: number };
  apply(entries: readonly ChangeEntry[], opts: ApplyOptions): ApplyResult;
  /** D7-01: the joiner's replicated data becomes exactly the team's, in one transaction. */
  replace(entries: readonly ChangeEntry[], now: number): ApplyResult;
  maxSeq(): number;
  /** Log rows after `seq` (pending changes for a peer whose cursor is `seq`). */
  countSince(seq: number): number;
  /** What a joining PC would lose (FR-201.2). */
  replicatedCounts(): {
    rooms: number;
    devices: number;
    tags: number;
    schedules: number;
    users: number;
  };
  /** Removes tombstones older than `before` that every member acknowledged (seq ≤ `ackedUpTo`). */
  pruneTombstones(before: number, ackedUpTo: number): number;
  /** Whether a run record exists for this occurrence (missed-run notices, FR-204.2). */
  hasRun(scheduleId: number, plannedAt: number): boolean;
}

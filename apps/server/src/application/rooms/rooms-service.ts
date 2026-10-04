/**
 * Rooms (FR-008.1). Deleting a room with devices or referenced by schedules needs explicit
 * confirmation; its devices move to "Sem sala" (FK ON DELETE SET NULL).
 */
import {
  DEFAULT_ROOM_COLOR,
  type Room,
  type RoomCreate,
  type RoomDeleteImpact,
  roomCreateSchema,
  type RoomUpdate,
  roomUpdateSchema,
} from '@uniwake/shared';
import { suggestRoomCode } from '../../domain/room-code';
import type { Actor, AuditService } from '../audit/audit-service';
import { AppError } from '../errors';
import type { Clock } from '../ports';

export interface RoomRow extends Room {
  deviceCount: number;
}

export interface RoomWrite {
  name: string;
  code: string;
  block: string | null;
  floor: string | null;
  color: string;
  notes: string | null;
  directedBroadcast: string | null;
  batchSize: number | null;
  batchDelaySeconds: number | null;
}

export interface RoomsRepo {
  list(): RoomRow[];
  get(id: number): RoomRow | undefined;
  codeTaken(code: string, exceptId?: number): boolean;
  nameTaken(name: string, exceptId?: number): boolean;
  insert(r: RoomWrite, now: number): number;
  update(id: number, r: RoomWrite, now: number): void;
  delete(id: number): void;
  schedulesReferencing(id: number): { id: number; name: string }[];
}

export class RoomsService {
  constructor(
    private readonly repo: RoomsRepo,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly transaction: <T>(fn: () => T) => T,
  ) {}

  list(): RoomRow[] {
    return this.repo.list();
  }

  get(id: number): RoomRow {
    const r = this.repo.get(id);
    if (!r) throw new AppError('NOT_FOUND');
    return r;
  }

  create(input: RoomCreate, actor: Actor): RoomRow {
    // Audit is written in the same transaction as the change (M2-F2, P4).
    return this.transaction(() => this.createTx(input, actor));
  }

  private createTx(input: RoomCreate, actor: Actor): RoomRow {
    const data = roomCreateSchema.parse(input);
    const id = this.transaction(() => {
      if (this.repo.nameTaken(data.name)) throw new AppError('ROOM_NAME_DUPLICATE');
      const code = data.code ?? suggestRoomCode(data.name, (c) => this.repo.codeTaken(c));
      if (data.code && this.repo.codeTaken(code))
        throw new AppError('ROOM_CODE_DUPLICATE', { code });
      return this.repo.insert(
        {
          name: data.name,
          code,
          block: data.block ?? null,
          floor: data.floor ?? null,
          color: data.color ?? DEFAULT_ROOM_COLOR,
          notes: data.notes ?? null,
          directedBroadcast: data.directedBroadcast ?? null,
          batchSize: data.batchSize ?? null,
          batchDelaySeconds: data.batchDelaySeconds ?? null,
        },
        this.clock.now(),
      );
    });
    const room = this.get(id);
    this.audit.record({
      actor,
      action: 'room.create',
      target: `room:${room.name}`,
      details: { id, code: room.code },
    });
    return room;
  }

  update(id: number, input: RoomUpdate, actor: Actor): RoomRow {
    // Audit is written in the same transaction as the change (M2-F2, P4).
    return this.transaction(() => this.updateTx(id, input, actor));
  }

  private updateTx(id: number, input: RoomUpdate, actor: Actor): RoomRow {
    const patch = roomUpdateSchema.parse(input);
    const current = this.get(id);
    const next: RoomWrite = {
      name: patch.name ?? current.name,
      code: patch.code ?? current.code,
      block: patch.block !== undefined ? patch.block : current.block,
      floor: patch.floor !== undefined ? patch.floor : current.floor,
      color: patch.color ?? current.color,
      notes: patch.notes !== undefined ? patch.notes : current.notes,
      directedBroadcast:
        patch.directedBroadcast !== undefined ? patch.directedBroadcast : current.directedBroadcast,
      batchSize: patch.batchSize !== undefined ? patch.batchSize : current.batchSize,
      batchDelaySeconds:
        patch.batchDelaySeconds !== undefined ? patch.batchDelaySeconds : current.batchDelaySeconds,
    };
    this.transaction(() => {
      if (next.name !== current.name && this.repo.nameTaken(next.name, id)) {
        throw new AppError('ROOM_NAME_DUPLICATE');
      }
      if (next.code !== current.code && this.repo.codeTaken(next.code, id)) {
        throw new AppError('ROOM_CODE_DUPLICATE', { code: next.code });
      }
      this.repo.update(id, next, this.clock.now());
    });
    const room = this.get(id);
    this.audit.record({
      actor,
      action: 'room.update',
      target: `room:${room.name}`,
      details: { id, changed: Object.keys(patch) },
    });
    return room;
  }

  deleteImpact(id: number): RoomDeleteImpact {
    const room = this.get(id);
    return { deviceCount: room.deviceCount, schedules: this.repo.schedulesReferencing(id) };
  }

  /** AC-008-01/03: without `confirm`, a room with devices or schedules is not deleted. */
  delete(id: number, confirm: boolean, actor: Actor): RoomDeleteImpact {
    // Audit is written in the same transaction as the change (M2-F2, P4).
    return this.transaction(() => this.deleteTx(id, confirm, actor));
  }

  private deleteTx(id: number, confirm: boolean, actor: Actor): RoomDeleteImpact {
    const room = this.get(id);
    const impact = this.deleteImpact(id);
    if (!confirm && (impact.deviceCount > 0 || impact.schedules.length > 0)) {
      throw new AppError(
        'DELETE_CONFIRMATION_REQUIRED',
        { devices: impact.deviceCount, schedules: impact.schedules.length },
        impact,
      );
    }
    this.repo.delete(id);
    this.audit.record({
      actor,
      action: 'room.delete',
      target: `room:${room.name}`,
      details: {
        id,
        movedToNoRoom: impact.deviceCount,
        schedules: impact.schedules.map((s) => s.id),
      },
    });
    return impact;
  }
}

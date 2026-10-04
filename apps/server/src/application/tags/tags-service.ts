/**
 * Tags (FR-008.2): free labels, many-to-many with devices. Deleting a tag removes it from every
 * device (FK cascade); if schedules target it, the deletion needs confirmation.
 */
import {
  DEFAULT_TAG_COLOR,
  type Tag,
  type TagCreate,
  tagCreateSchema,
  type TagUpdate,
  tagUpdateSchema,
} from '@uniwake/shared';
import type { Actor, AuditService } from '../audit/audit-service';
import { AppError } from '../errors';

export interface TagsRepo {
  list(): Required<Tag>[];
  get(id: number): Required<Tag> | undefined;
  nameTaken(name: string, exceptId?: number): boolean;
  insert(name: string, color: string): number;
  update(id: number, name: string, color: string): void;
  delete(id: number): void;
  schedulesReferencing(id: number): { id: number; name: string }[];
}

export interface TagDeleteImpact {
  deviceCount: number;
  schedules: { id: number; name: string }[];
}

export class TagsService {
  constructor(
    private readonly repo: TagsRepo,
    private readonly audit: AuditService,
    private readonly transaction: <T>(fn: () => T) => T,
  ) {}

  list(): Required<Tag>[] {
    return this.repo.list();
  }

  get(id: number): Required<Tag> {
    const t = this.repo.get(id);
    if (!t) throw new AppError('NOT_FOUND');
    return t;
  }

  create(input: TagCreate, actor: Actor): Required<Tag> {
    const data = tagCreateSchema.parse(input);
    const id = this.transaction(() => {
      if (this.repo.nameTaken(data.name)) throw new AppError('TAG_NAME_DUPLICATE');
      return this.repo.insert(data.name, data.color ?? DEFAULT_TAG_COLOR);
    });
    this.audit.record({ actor, action: 'tag.create', target: `tag:${data.name}`, details: { id } });
    return this.get(id);
  }

  update(id: number, input: TagUpdate, actor: Actor): Required<Tag> {
    const patch = tagUpdateSchema.parse(input);
    const current = this.get(id);
    const name = patch.name ?? current.name;
    this.transaction(() => {
      if (name !== current.name && this.repo.nameTaken(name, id)) {
        throw new AppError('TAG_NAME_DUPLICATE');
      }
      this.repo.update(id, name, patch.color ?? current.color);
    });
    this.audit.record({ actor, action: 'tag.update', target: `tag:${name}`, details: { id } });
    return this.get(id);
  }

  deleteImpact(id: number): TagDeleteImpact {
    const tag = this.get(id);
    return { deviceCount: tag.deviceCount, schedules: this.repo.schedulesReferencing(id) };
  }

  /** AC-008-04: devices lose the tag. Schedules referencing it require confirmation. */
  delete(id: number, confirm: boolean, actor: Actor): TagDeleteImpact {
    const tag = this.get(id);
    const impact = this.deleteImpact(id);
    if (!confirm && impact.schedules.length > 0) {
      throw new AppError(
        'DELETE_CONFIRMATION_REQUIRED',
        { devices: 0, schedules: impact.schedules.length },
        impact,
      );
    }
    this.repo.delete(id);
    this.audit.record({
      actor,
      action: 'tag.delete',
      target: `tag:${tag.name}`,
      details: { id, removedFromDevices: impact.deviceCount },
    });
    return impact;
  }
}

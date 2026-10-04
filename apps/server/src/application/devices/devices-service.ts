/**
 * Devices (FR-002.1). MAC is the identity (unique, normalized); names may repeat (warning only).
 * Disabled devices are excluded from wake/sweeps and reported as `desconhecido` (AC-002-05).
 */
import {
  type Device,
  type DeviceCompact,
  type DeviceCreate,
  deviceCreateSchema,
  type DeviceListParams,
  type DeviceSaveResult,
  type DeviceUpdate,
  deviceUpdateSchema,
  isLocallyAdministered,
  LIMITS,
  type Page,
} from '@uniwake/shared';
import type { Actor, AuditService } from '../audit/audit-service';
import { AppError } from '../errors';
import type { Clock } from '../ports';

export interface DeviceWrite {
  name: string;
  mac: string;
  ip: string | null;
  hostname: string | null;
  roomId: number | null;
  notes: string | null;
  enabled: boolean;
}

export interface DeviceFilter {
  roomId?: number | 'none';
  tagId?: number;
  status?: Device['status'];
  q?: string;
}

export interface DevicesRepo {
  get(id: number): Device | undefined;
  findByMac(mac: string): { id: number; name: string } | undefined;
  countByName(name: string, exceptId?: number): number;
  roomExists(id: number): boolean;
  missingTags(ids: readonly number[]): number[];
  insert(d: DeviceWrite, now: number): number;
  update(id: number, d: DeviceWrite, now: number): void;
  setTags(id: number, tagIds: readonly number[]): void;
  delete(id: number): void;
  list(filter: DeviceFilter, limit: number, offset: number): { items: Device[]; total: number };
  listCompact(filter: DeviceFilter, limit: number): DeviceCompact[];
}

export class DevicesService {
  constructor(
    private readonly repo: DevicesRepo,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly transaction: <T>(fn: () => T) => T,
  ) {}

  get(id: number): Device {
    const d = this.repo.get(id);
    if (!d) throw new AppError('NOT_FOUND');
    return d;
  }

  list(q: DeviceListParams): Page<Device> | DeviceCompact[] {
    const filter: DeviceFilter = {
      ...(q.roomId !== undefined ? { roomId: q.roomId } : {}),
      ...(q.tagId !== undefined ? { tagId: q.tagId } : {}),
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.q ? { q: q.q } : {}),
    };
    if (q.all) return this.repo.listCompact(filter, LIMITS.compactListMax);
    const { items, total } = this.repo.list(filter, q.pageSize, (q.page - 1) * q.pageSize);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  private checkRefs(roomId: number | null | undefined, tagIds: readonly number[] | undefined) {
    const problems: { path: string; message: string }[] = [];
    if (roomId !== null && roomId !== undefined && !this.repo.roomExists(roomId)) {
      problems.push({ path: 'roomId', message: 'Sala não encontrada.' });
    }
    if (tagIds && this.repo.missingTags(tagIds).length > 0) {
      problems.push({ path: 'tagIds', message: 'Etiqueta não encontrada.' });
    }
    if (problems.length > 0) throw new AppError('VALIDATION_FAILED', {}, problems);
  }

  private assertMacFree(mac: string, exceptId?: number) {
    const existing = this.repo.findByMac(mac);
    if (existing && existing.id !== exceptId) {
      throw new AppError(
        'DEVICE_MAC_DUPLICATE',
        { mac, deviceName: existing.name },
        { deviceId: existing.id },
      );
    }
  }

  private result(id: number): DeviceSaveResult {
    const device = this.get(id);
    const warnings: DeviceSaveResult['warnings'] = [];
    if (isLocallyAdministered(device.mac)) warnings.push('mac_locally_administered');
    if (this.repo.countByName(device.name, id) > 0) warnings.push('duplicate_name');
    return { device, warnings };
  }

  create(input: DeviceCreate, actor: Actor): DeviceSaveResult {
    const data = deviceCreateSchema.parse(input);
    const id = this.transaction(() => {
      this.checkRefs(data.roomId, data.tagIds);
      this.assertMacFree(data.mac);
      const id = this.repo.insert(
        {
          name: data.name,
          mac: data.mac,
          ip: data.ip ?? null,
          hostname: data.hostname ?? null,
          roomId: data.roomId ?? null,
          notes: data.notes ?? null,
          enabled: data.enabled ?? true,
        },
        this.clock.now(),
      );
      if (data.tagIds?.length) this.repo.setTags(id, data.tagIds);
      return id;
    });
    this.audit.record({
      actor,
      action: 'device.create',
      target: `device:${data.name}`,
      details: { id, mac: data.mac },
    });
    return this.result(id);
  }

  update(id: number, input: DeviceUpdate, actor: Actor): DeviceSaveResult {
    const patch = deviceUpdateSchema.parse(input);
    this.transaction(() => {
      const cur = this.get(id);
      this.checkRefs(patch.roomId, patch.tagIds);
      if (patch.mac && patch.mac !== cur.mac) this.assertMacFree(patch.mac, id);
      this.repo.update(
        id,
        {
          name: patch.name ?? cur.name,
          mac: patch.mac ?? cur.mac,
          ip: patch.ip !== undefined ? patch.ip : cur.ip,
          hostname: patch.hostname !== undefined ? patch.hostname : cur.hostname,
          roomId: patch.roomId !== undefined ? patch.roomId : cur.roomId,
          notes: patch.notes !== undefined ? patch.notes : cur.notes,
          enabled: patch.enabled ?? cur.enabled,
        },
        this.clock.now(),
      );
      if (patch.tagIds) this.repo.setTags(id, patch.tagIds);
    });
    this.audit.record({
      actor,
      action: 'device.update',
      target: `device:${this.get(id).name}`,
      details: { id, changed: Object.keys(patch) },
    });
    return this.result(id);
  }

  delete(id: number, actor: Actor): void {
    const d = this.get(id);
    this.repo.delete(id);
    this.audit.record({
      actor,
      action: 'device.delete',
      target: `device:${d.name}`,
      details: { id, mac: d.mac },
    });
  }
}

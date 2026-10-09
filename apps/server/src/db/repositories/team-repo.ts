import type {
  ConflictRow,
  MemberRow,
  PeerRow,
  TeamRepo,
  TeamRow,
} from '../../application/team/team-service';
import type { Db } from '../connection';
import { changeLog } from '../sync/change-log';

interface TeamDbRow {
  team_id: string;
  epoch: number;
  key_blob: Uint8Array;
  prev_epoch: number | null;
  prev_key_blob: Uint8Array | null;
  member_secret_blob: Uint8Array;
  joined_at: number;
}

const buf = (b: Uint8Array) => Buffer.from(b);

const toMember = (r: {
  uuid: string;
  name: string;
  verifier: string;
  joined_at: number;
  revoked_at: number | null;
}): MemberRow => ({
  instanceId: r.uuid,
  name: r.name,
  verifier: r.verifier,
  joinedAt: r.joined_at,
  revokedAt: r.revoked_at,
});

interface PeerDbRow {
  instance_id: string;
  address: string | null;
  manual_address: string | null;
  port: number | null;
  last_seen_at: number | null;
  last_sync_at: number | null;
  last_error: string | null;
  pulled_seq: number;
  acked_seq: number;
}

const toPeer = (r: PeerDbRow): PeerRow => ({
  instanceId: r.instance_id,
  address: r.address,
  manualAddress: r.manual_address,
  port: r.port,
  lastSeenAt: r.last_seen_at,
  lastSyncAt: r.last_sync_at,
  lastError: r.last_error,
  pulledSeq: r.pulled_seq,
  ackedSeq: r.acked_seq,
});

const PEER_COLUMNS: Record<keyof Omit<PeerRow, 'instanceId'>, string> = {
  address: 'address',
  manualAddress: 'manual_address',
  port: 'port',
  lastSeenAt: 'last_seen_at',
  lastSyncAt: 'last_sync_at',
  lastError: 'last_error',
  pulledSeq: 'pulled_seq',
  ackedSeq: 'acked_seq',
};

export class SqliteTeamRepo implements TeamRepo {
  constructor(private readonly db: Db) {}

  team(): TeamRow | undefined {
    const r = this.db.get<TeamDbRow>('SELECT * FROM team WHERE id = 1');
    return (
      r && {
        teamId: r.team_id,
        epoch: r.epoch,
        keyBlob: buf(r.key_blob),
        prevEpoch: r.prev_epoch,
        prevKeyBlob: r.prev_key_blob ? buf(r.prev_key_blob) : null,
        memberSecretBlob: buf(r.member_secret_blob),
        joinedAt: r.joined_at,
      }
    );
  }

  saveTeam(t: TeamRow): void {
    this.db.run(
      `INSERT INTO team (id, team_id, epoch, key_blob, prev_epoch, prev_key_blob, member_secret_blob, joined_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET team_id = excluded.team_id, epoch = excluded.epoch,
         key_blob = excluded.key_blob, prev_epoch = excluded.prev_epoch,
         prev_key_blob = excluded.prev_key_blob, member_secret_blob = excluded.member_secret_blob`,
      [t.teamId, t.epoch, t.keyBlob, t.prevEpoch, t.prevKeyBlob, t.memberSecretBlob, t.joinedAt],
    );
  }

  clearTeam(): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM team');
      this.db.run('DELETE FROM sync_peers');
      // The member list described the team this PC left: drop it with its log rows.
      this.db.run("DELETE FROM change_log WHERE entity = 'team_member'");
      this.db.run('DELETE FROM team_members');
    });
  }

  members(): MemberRow[] {
    return this.db
      .all<Parameters<typeof toMember>[0]>(
        'SELECT uuid, name, verifier, joined_at, revoked_at FROM team_members ORDER BY name COLLATE NOCASE, uuid',
      )
      .map(toMember);
  }

  member(instanceId: string): MemberRow | undefined {
    const r = this.db.get<Parameters<typeof toMember>[0]>(
      'SELECT uuid, name, verifier, joined_at, revoked_at FROM team_members WHERE uuid = ?',
      [instanceId],
    );
    return r && toMember(r);
  }

  saveMember(m: MemberRow): void {
    this.db.transaction(() => {
      const existing = this.db.get<{ id: number }>('SELECT id FROM team_members WHERE uuid = ?', [
        m.instanceId,
      ])?.id;
      const id =
        existing ??
        this.db.run(
          'INSERT INTO team_members (uuid, name, verifier, joined_at, revoked_at) VALUES (?, ?, ?, ?, ?)',
          [m.instanceId, m.name, m.verifier, m.joinedAt, m.revokedAt],
        ).lastInsertRowid;
      if (existing !== undefined) {
        this.db.run(
          'UPDATE team_members SET name = ?, verifier = ?, joined_at = ?, revoked_at = ? WHERE id = ?',
          [m.name, m.verifier, m.joinedAt, m.revokedAt, id],
        );
      }
      changeLog(this.db).touch('team_member', id);
    });
  }

  peers(): PeerRow[] {
    return this.db.all<PeerDbRow>('SELECT * FROM sync_peers').map(toPeer);
  }

  peer(instanceId: string): PeerRow | undefined {
    const r = this.db.get<PeerDbRow>('SELECT * FROM sync_peers WHERE instance_id = ?', [
      instanceId,
    ]);
    return r && toPeer(r);
  }

  savePeer(p: Partial<PeerRow> & { instanceId: string }): void {
    this.db.run('INSERT OR IGNORE INTO sync_peers (instance_id) VALUES (?)', [p.instanceId]);
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    for (const [k, col] of Object.entries(PEER_COLUMNS) as [keyof typeof PEER_COLUMNS, string][]) {
      if (k in p) {
        sets.push(`${col} = ?`);
        params.push(p[k] ?? null);
      }
    }
    if (sets.length > 0) {
      this.db.run(`UPDATE sync_peers SET ${sets.join(', ')} WHERE instance_id = ?`, [
        ...params,
        p.instanceId,
      ]);
    }
  }

  conflicts(limit: number): ConflictRow[] {
    return this.db
      .all<{
        id: number;
        at: number;
        entity: string;
        entity_id: string;
        label: string;
        kind: string;
        kept: string;
        discarded: string;
        winner_instance: string | null;
      }>('SELECT * FROM sync_conflicts ORDER BY at DESC, id DESC LIMIT ?', [limit])
      .map((r) => ({
        id: r.id,
        at: r.at,
        entity: r.entity,
        entityId: r.entity_id,
        label: r.label,
        kind: r.kind,
        kept: JSON.parse(r.kept) as unknown,
        discarded: JSON.parse(r.discarded) as unknown,
        winnerInstance: r.winner_instance,
      }));
  }

  addConflicts(c: readonly Omit<ConflictRow, 'id' | 'at'>[], at: number): void {
    for (const x of c) {
      this.db.run(
        `INSERT INTO sync_conflicts (at, entity, entity_id, label, kind, kept, discarded, winner_instance)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          at,
          x.entity,
          x.entityId,
          x.label,
          x.kind,
          JSON.stringify(x.kept ?? null),
          JSON.stringify(x.discarded ?? null),
          x.winnerInstance,
        ],
      );
    }
  }
}

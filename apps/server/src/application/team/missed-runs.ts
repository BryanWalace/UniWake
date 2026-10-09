/**
 * FR-204.2 "Ligar agora": wakes the target of a run missed while this PC was off, when the operator
 * decides to (the scheduler never replays it by itself in team mode).
 */
import type { Actor } from '../audit/audit-service';
import { AppError } from '../errors';
import type { NoticesService } from '../notices/notices-service';
import type { SchedulesService } from '../schedules/schedules-service';
import type { StartOptions, StartResult } from '../wake/wake-service';
import type { WakeRequestParams } from '@uniwake/shared';

export interface MissedRunsDeps {
  notices: NoticesService;
  schedules: SchedulesService;
  startWake: (req: WakeRequestParams, actor: Actor, opts: StartOptions) => StartResult;
}

export class MissedRunsService {
  constructor(private readonly d: MissedRunsDeps) {}

  wakeNow(noticeId: number, actor: Actor): StartResult {
    const missed = this.d.notices.missedRunNotice(noticeId);
    if (!missed) throw new AppError('MISSED_RUN_NOT_FOUND');
    let target;
    try {
      target = this.d.schedules.target(missed.scheduleId);
    } catch {
      throw new AppError('MISSED_RUN_NOT_FOUND');
    }
    const r = this.d.startWake(
      { target: target.target, onlyOffline: target.record.onlyOffline },
      actor,
      // Confirmed when the schedule was saved (SR-10), like the scheduled run itself.
      { preConfirmed: true },
    );
    this.d.notices.acknowledge(noticeId, actor);
    return r;
  }
}

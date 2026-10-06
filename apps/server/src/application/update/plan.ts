/**
 * The update plan the hub writes and the updater executes (ADR-023, plan §8). The updater runs
 * as SYSTEM, so it re-validates the file instead of trusting it: fixed service name, installer and
 * backup inside the data dir, health URL on loopback.
 */
import { z } from 'zod';

const hex64 = /^[0-9a-f]{64}$/;
const version = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

export const updatePlanSchema = z.object({
  version,
  previousVersion: version,
  /** %ProgramFiles%\UniWake: holds UniWakeService.exe/.xml and versions\. */
  installDir: z.string().min(3).max(260),
  dataDir: z.string().min(3).max(260),
  installer: z.string().min(3).max(260),
  sha256: z.string().regex(hex64),
  serviceName: z.literal('UniWake'),
  healthUrl: z.string().regex(/^http:\/\/127\.0\.0\.1:\d{1,5}\/api\/health$/),
  backupFile: z.string().max(260).nullable(),
  schemaVersion: z.number().int().nonnegative(),
  createdAt: z.number().int(),
});
export type UpdatePlan = z.infer<typeof updatePlanSchema>;

/** `child` is inside `parent` (Windows paths, case-insensitive, no "..")? */
export function isInside(parent: string, child: string): boolean {
  const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const c = norm(child);
  return !c.split('\\').includes('..') && c.startsWith(`${norm(parent)}\\`);
}

/** Parses and checks a plan read from disk; throws on anything unexpected. */
export function parsePlan(json: string): UpdatePlan {
  const plan = updatePlanSchema.parse(JSON.parse(json));
  const updates = `${plan.dataDir}\\updates`;
  if (!isInside(updates, plan.installer) || !plan.installer.toLowerCase().endsWith('.exe')) {
    throw new Error(`installer outside ${updates}: ${plan.installer}`);
  }
  if (plan.backupFile !== null && !isInside(`${plan.dataDir}\\backups`, plan.backupFile)) {
    throw new Error(`backup outside the data dir: ${plan.backupFile}`);
  }
  return plan;
}

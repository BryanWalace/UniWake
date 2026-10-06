/**
 * Device diagnostics (FR-010, IMP-005, IMP-009, IMP-012): why a computer may not wake, with a
 * pt-BR next step and a help page for each problem (FR-007.5).
 */
import type { HelpTopic } from '../errors';
import type { TestWolRun } from './test-wol';

export const DIAGNOSTIC_PROBLEMS = [
  'parou_de_acordar',
  'nunca_respondeu',
  'outra_subrede',
  'mac_virtual',
  'sem_interface',
] as const;
export type DiagnosticProblemCode = (typeof DIAGNOSTIC_PROBLEMS)[number];

export interface DiagnosticProblem {
  code: DiagnosticProblemCode;
  title: string;
  message: string;
  help: HelpTopic | null;
}

export interface WakeStats {
  /** Wakes with a verified answer (acordou / não respondeu), newest 30. */
  attempts: number;
  successes: number;
  /** 0..1, null without attempts. */
  successRate: number | null;
  lastSuccessAt: number | null;
  /** Current run of "não respondeu", newest first. */
  consecutiveFailures: number;
  /** ≥ 3 "não respondeu" in a row after at least one "acordou" (AC-010-01). */
  stoppedWaking: boolean;
}

export interface DeviceDiagnostics {
  deviceId: number;
  problems: DiagnosticProblem[];
  mac: string;
  macLocallyAdministered: boolean;
  otherMacs: string[];
  wake: WakeStats;
  network: {
    deviceIp: string | null;
    interfaces: { name: string; address: string; prefixLength: number }[];
    /** null when the computer has no IP to compare. */
    sameSubnet: boolean | null;
    destinations: { sourceIp: string; destination: string }[];
  };
  lastTestWol: TestWolRun | null;
  prepare: {
    preparedAt: number | null;
    enrolledAt: number | null;
    results: Record<string, string> | null;
  };
}

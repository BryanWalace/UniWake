/** Update status (FR-001.2, FR-001.3) shown on the update panel and the health page. */
export interface UpdateRelease {
  version: string;
  name: string;
  /** Release notes (Markdown text from GitHub, shown as plain text). */
  notes: string;
  publishedAt: string;
}

export interface UpdateStatus {
  current: string;
  /** false in demo mode and builds without an update source: nothing is checked. */
  enabled: boolean;
  mode: 'auto' | 'manual';
  latest: UpdateRelease | null;
  /** A newer version with a published installer and checksum. */
  available: boolean;
  checking: boolean;
  lastCheckAt: number | null;
  lastSuccessAt: number | null;
  nextCheckAt: number | null;
  /** pt-BR; null when the last check worked (AC-001-06). */
  error: string | null;
}

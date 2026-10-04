import type { Verifier, VerifyTarget } from '../wake/verifier';

/** Wraps the wake verifier so devices it sees answering become online at once (FR-004.1). */
export class ObservingVerifier implements Verifier {
  constructor(
    private readonly inner: Verifier,
    private readonly onAlive: (deviceIds: readonly number[]) => void,
  ) {}

  async check(targets: readonly VerifyTarget[]): Promise<Set<number>> {
    const alive = await this.inner.check(targets);
    try {
      this.onAlive([...alive]);
    } catch {
      // Status bookkeeping must never fail a wake job; the next sweep catches up.
    }
    return alive;
  }
}

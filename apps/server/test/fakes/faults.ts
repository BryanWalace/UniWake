/**
 * Fault injection helper shared by fakes (constitution §2.2): fail the Nth call, every call
 * matching a predicate, or the next N calls.
 */
export class FaultPlan<A> {
  private calls = 0;
  private rules: {
    match: (arg: A, call: number) => boolean;
    error: () => Error;
    remaining: number;
  }[] = [];

  /** Fails call number `n` (1-based). */
  failNth(n: number, error: Error | (() => Error) = new Error('injected fault')): this {
    return this.add((_, call) => call === n, error, 1);
  }

  /** Fails the next `count` calls. */
  failNext(count = 1, error: Error | (() => Error) = new Error('injected fault')): this {
    const start = this.calls;
    return this.add((_, call) => call > start && call <= start + count, error, count);
  }

  /** Fails every call whose argument matches. */
  failWhen(
    match: (arg: A) => boolean,
    error: Error | (() => Error) = new Error('injected fault'),
  ): this {
    return this.add((arg) => match(arg), error, Number.POSITIVE_INFINITY);
  }

  clear(): void {
    this.rules = [];
  }

  get callCount(): number {
    return this.calls;
  }

  /** Records a call; throws the injected error if a rule matches. */
  check(arg: A): void {
    this.calls++;
    for (const rule of this.rules) {
      if (rule.remaining > 0 && rule.match(arg, this.calls)) {
        rule.remaining--;
        throw rule.error();
      }
    }
  }

  private add(
    match: (arg: A, call: number) => boolean,
    error: Error | (() => Error),
    remaining: number,
  ): this {
    this.rules.push({ match, error: typeof error === 'function' ? error : () => error, remaining });
    return this;
  }
}

export function errnoError(code: string, message = code): NodeJS.ErrnoException {
  const e: NodeJS.ErrnoException = new Error(message);
  e.code = code;
  return e;
}

import type { LlmProvider, StructuredRequest, TurnRequest } from './llm.types';

/**
 * Spaces out model requests by at least `minIntervalMs` (e.g. to stay under a
 * free tier's requests-per-minute limit). Requests are started in call order;
 * the wrapped provider is otherwise unchanged.
 */
export class ThrottledProvider implements LlmProvider {
  private nextSlot = 0;

  constructor(
    private readonly inner: LlmProvider,
    private readonly minIntervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get name(): LlmProvider['name'] {
    return this.inner.name;
  }

  get model(): string {
    return this.inner.model;
  }

  async runTurn(req: TurnRequest) {
    await this.wait(req.signal);
    return this.inner.runTurn(req);
  }

  async generateStructured<T>(req: StructuredRequest<T>) {
    await this.wait(req.signal);
    return this.inner.generateStructured(req);
  }

  private async wait(signal?: AbortSignal): Promise<void> {
    const start = Math.max(this.now(), this.nextSlot);
    this.nextSlot = start + this.minIntervalMs;
    const delay = start - this.now();
    if (delay <= 0) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delay);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

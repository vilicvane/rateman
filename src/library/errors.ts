export class RateLimitExceededError extends Error {
  readonly status = 429;

  constructor(message: string, readonly liftsAt: number) {
    super(message);
    this.name = new.target.name;
  }
}

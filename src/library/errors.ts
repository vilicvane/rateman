export class RateLimitExceededError extends Error {
  readonly status = 429;

  constructor(
    readonly rateLimiterName: string,
    readonly liftsAt: number,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class RateLimitReachedError extends Error {
  constructor(message: string, readonly liftsAt: Date) {
    super(message);
    this.name = new.target.name;
  }
}

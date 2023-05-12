export class RateLimitReachedError extends Error {
  constructor(message: string, readonly liftsAt: number) {
    super(message);
    this.name = new.target.name;
  }
}

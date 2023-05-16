const NULL_PROTOTYPE = Object.getPrototypeOf({});

export function isPlainObject(value: unknown): boolean {
  return value != null && Object.getPrototypeOf(value) === NULL_PROTOTYPE;
}

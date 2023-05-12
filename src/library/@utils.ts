export function isPlainObject(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && value.constructor === Object
  );
}

/** Deep clone helper used at simulation transaction boundaries. */
export function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Runtime assertion for impossible internal states; external data uses schemas instead. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Recursively freezes plain simulation state to prevent view-layer mutation. */
export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

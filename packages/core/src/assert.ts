/** Makes the compiler fail when a switch misses a case. */
export function assertNever(value: never, message = "Unexpected value"): never {
  throw new Error(`${message}: ${String(value)}`);
}

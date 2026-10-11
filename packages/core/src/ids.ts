/**
 * Branded IDs stop a studio ID being passed where an order ID is expected.
 * Every record belongs to a studio (D96: cross-studio leak protection starts in the types).
 */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type StudioId = Brand<string, "StudioId">;
export type UserId = Brand<string, "UserId">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function studioId(value: string): StudioId {
  if (!isUuid(value)) throw new Error("Studio ID must be a UUID");
  return value as StudioId;
}

export function userId(value: string): UserId {
  if (!isUuid(value)) throw new Error("User ID must be a UUID");
  return value as UserId;
}

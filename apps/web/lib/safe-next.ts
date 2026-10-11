/** Only allow redirects to our own paths (no open redirects). Shared by server and browser code. */
export function safeNextClient(next: string | null | undefined, fallback = "/app"): string {
  return next && /^\/(?!\/)[\w\-/?=&.%]*$/.test(next) ? next : fallback;
}

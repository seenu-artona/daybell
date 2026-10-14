export type Greeting = "morning" | "afternoon" | "evening";

/**
 * Home's title by the viewer's local hour, 0-23 (D146): morning from 5 AM to noon, afternoon until 6 PM, evening
 * otherwise (late night included).
 */
export function greetingFor(hour: number): Greeting {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

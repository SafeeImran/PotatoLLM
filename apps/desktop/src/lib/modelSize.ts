/** Parses a display string like "7B" / "0.5B" / "1.1B" into billions of params as a number. */
export function parseParamCount(value: string): number {
  const match = value.match(/([\d.]+)\s*B/i);
  return match ? parseFloat(match[1]) : 0;
}

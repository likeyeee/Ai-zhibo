export function nextBackoff(attempt: number): number {
  const step = Math.min(Math.max(attempt, 0), 4);
  return Math.min(15_000, 1000 * 2 ** step);
}

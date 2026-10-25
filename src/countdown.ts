// Time until a quota reset: hh:mm for the 5-hour window, dd:hh:mm for the weekly ones, zero-padded.
export function countdown(ms: number, session: boolean): string {
  const m = Math.max(0, Math.round(ms / 60000));
  const two = (n: number) => String(n).padStart(2, '0');
  if (session) return `${two(Math.floor(m / 60))}:${two(m % 60)}`;
  return `${two(Math.floor(m / 1440))}:${two(Math.floor(m / 60) % 24)}:${two(m % 60)}`;
}

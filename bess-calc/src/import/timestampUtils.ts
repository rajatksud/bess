// Timestamp parsing per the CSV import spec: ISO 8601 required, explicit offsets
// accepted as-is, and when no offset is present the tariff's IANA timezone is used to
// resolve the wall-clock time to an absolute instant (never the host's local time).

const ISO_WITH_OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/;
const ISO_BASIC_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/;

export interface TimestampParseResult {
  iso: string | undefined;
  error?: string;
}

/**
 * Resolves a wall-clock "YYYY-MM-DDTHH:mm:ss" (no offset) in the given IANA timezone to
 * an absolute UTC instant, using the offset the Intl API reports for that timezone at
 * that date (correctly handles DST transitions except for the ambiguous/skipped wall
 * clock cases handled separately by the DST detector below).
 */
function resolveWallClockInTimezone(y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number, timezone: string): number {
  // Start from a UTC guess, then correct using the timezone's actual offset at that
  // instant (iterate once - offsets are piecewise constant, one correction suffices
  // except exactly at a DST transition boundary, which the caller flags separately).
  const utcGuessMs = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  const offsetMinutes = getTimezoneOffsetMinutes(timezone, utcGuessMs);
  return utcGuessMs - offsetMinutes * 60 * 1000;
}

function getTimezoneOffsetMinutes(timezone: string, atUtcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = dtf.formatToParts(new Date(atUtcMs));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') === 24 ? 0 : get('hour'), get('minute'), get('second'));
  return (asUtc - atUtcMs) / 60000;
}

export function parseTimestamp(raw: string, tariffTimezone: string): TimestampParseResult {
  const trimmed = raw.trim();
  if (!trimmed) return { iso: undefined, error: 'Missing timestamp' };

  const match = ISO_BASIC_RE.exec(trimmed);
  if (!match) {
    return { iso: undefined, error: `Timestamp is not valid ISO 8601: "${raw}"` };
  }

  const [, yStr, moStr, dStr, hStr, miStr, sStr, msStr] = match;
  const y = Number(yStr), mo = Number(moStr), d = Number(dStr), h = Number(hStr), mi = Number(miStr);
  const s = sStr ? Number(sStr) : 0;
  const ms = msStr ? Number(msStr.padEnd(3, '0').slice(0, 3)) : 0;

  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) {
    return { iso: undefined, error: `Timestamp has an out-of-range component: "${raw}"` };
  }

  const hasOffset = ISO_WITH_OFFSET_RE.test(trimmed);
  if (hasOffset) {
    const parsedMs = Date.parse(trimmed);
    if (Number.isNaN(parsedMs)) {
      return { iso: undefined, error: `Timestamp with offset failed to parse: "${raw}"` };
    }
    return { iso: new Date(parsedMs).toISOString() };
  }

  // No offset: resolve using the tariff's IANA timezone.
  const resolvedMs = resolveWallClockInTimezone(y, mo, d, h, mi, s, ms, tariffTimezone);
  return { iso: new Date(resolvedMs).toISOString() };
}

/**
 * Detects whether a wall-clock local timestamp (no offset) falls in a DST "spring
 * forward" gap (doesn't exist) or "fall back" overlap (occurs twice) for the given
 * timezone. Method: resolve the naive wall-clock time using the timezone's offset
 * exactly 24 hours earlier (a point guaranteed outside the transition window) and
 * separately using the offset 24 hours later, then re-derive what wall-clock time each
 * resulting UTC instant actually displays as in the target timezone.
 *   - If NEITHER round-trip reproduces the original wall-clock time, it was skipped
 *     (spring-forward gap - that local time never occurs).
 *   - If BOTH round-trip and the two offsets differ, the wall-clock time is ambiguous
 *     (fall-back overlap - that local time occurs twice, once per offset).
 */
export function detectDstAnomaly(raw: string, tariffTimezone: string): 'skipped' | 'ambiguous' | 'none' {
  const match = ISO_BASIC_RE.exec(raw.trim());
  if (!match || ISO_WITH_OFFSET_RE.test(raw.trim())) return 'none';
  const [, yStr, moStr, dStr, hStr, miStr] = match;
  const y = Number(yStr), mo = Number(moStr), d = Number(dStr), h = Number(hStr), mi = Number(miStr);

  const naiveUtcMs = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  const dayMs = 24 * 3600 * 1000;
  const offsetDayBefore = getTimezoneOffsetMinutes(tariffTimezone, naiveUtcMs - dayMs);
  const offsetDayAfter = getTimezoneOffsetMinutes(tariffTimezone, naiveUtcMs + dayMs);

  if (offsetDayBefore === offsetDayAfter) return 'none'; // no transition within +/-1 day

  const candidateMsUsingBeforeOffset = naiveUtcMs - offsetDayBefore * 60000;
  const candidateMsUsingAfterOffset = naiveUtcMs - offsetDayAfter * 60000;

  const actualOffsetAtBeforeCandidate = getTimezoneOffsetMinutes(tariffTimezone, candidateMsUsingBeforeOffset);
  const actualOffsetAtAfterCandidate = getTimezoneOffsetMinutes(tariffTimezone, candidateMsUsingAfterOffset);

  const existsUnderBeforeOffset = actualOffsetAtBeforeCandidate === offsetDayBefore;
  const existsUnderAfterOffset = actualOffsetAtAfterCandidate === offsetDayAfter;

  if (!existsUnderBeforeOffset && !existsUnderAfterOffset) return 'skipped';
  if (existsUnderBeforeOffset && existsUnderAfterOffset) return 'ambiguous';
  return 'none';
}

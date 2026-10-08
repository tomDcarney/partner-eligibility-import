import { CanonicalField, CanonicalMember } from '../domain/member.js';
import { DateFormat, SourceProfile, requiredFields } from '../domain/profile.js';
import { RawRecord } from '../csv/reader.js';

export interface Rejection {
  /** The specific field that failed, or 'row' for whole-row problems. */
  field: CanonicalField | 'row';
  reason: string;
}

export type ValidationResult =
  | { ok: true; member: CanonicalMember }
  | { ok: false; rejections: Rejection[] };

const DATE_FIELDS: readonly CanonicalField[] = ['date_of_birth', 'policy_start', 'policy_end'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse a raw date string according to the profile's declared format into
 * a strict ISO-8601 (YYYY-MM-DD) string, verifying it is a real calendar
 * date (no "31/02/2020"-style overflow). Returns null if unparsable.
 */
function parseDate(raw: string, format: DateFormat): string | null {
  let year: number, month: number, day: number;

  if (format === 'YYYY-MM-DD') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!m) return null;
    [year, month, day] = [Number(m[1]!), Number(m[2]!), Number(m[3]!)];
  } else if (format === 'DD/MM/YYYY') {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
    if (!m) return null;
    [day, month, year] = [Number(m[1]!), Number(m[2]!), Number(m[3]!)];
  } else if (format === 'MM/DD/YYYY') {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
    if (!m) return null;
    [month, day, year] = [Number(m[1]!), Number(m[2]!), Number(m[3]!)];
  } else {
    return null;
  }

  if (!isRealCalendarDate(year, month, day)) return null;

  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return iso;
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (month < 1 || month > 12 || day < 1) return false;
  // new Date(0) + setUTCFullYear avoids Date.UTC's legacy behavior of
  // mapping a two-digit year (0-99) onto 1900+year, so a literal year
  // like 99 or 0099 is treated as-is rather than becoming 1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  // Date normalizes overflow (e.g. Feb 31 -> Mar 3); reject anything that
  // doesn't round-trip exactly, which catches invalid day-of-month values.
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isoToUtcDate(iso: string): Date {
  const parts = iso.split('-').map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Validate and normalise one raw CSV record against a source profile.
 * Returns either an accepted canonical member or the full list of
 * rejections (every failing field is reported, not just the first).
 */
export function validateRecord(record: RawRecord, profile: SourceProfile): ValidationResult {
  const rejections: Rejection[] = [];
  const required = new Set(requiredFields(profile));
  const normalised: Partial<CanonicalMember> = {};

  // Required-field presence. partner_member_id is always required: it is
  // part of member identity and a profile cannot opt it out.
  const NULLABLE_FIELDS = ['first_name', 'last_name', 'date_of_birth', 'email', 'policy_start', 'policy_end'] as const;
  for (const field of ['partner_member_id', ...NULLABLE_FIELDS] as CanonicalField[]) {
    const raw = record.values[field];
    if (raw === undefined) {
      if (field === 'partner_member_id' || required.has(field)) {
        rejections.push({ field, reason: 'missing required field' });
      } else {
        normalised[field as (typeof NULLABLE_FIELDS)[number]] = null;
      }
    }
  }

  // partner_member_id: no further format validation beyond presence.
  if (record.values.partner_member_id !== undefined) {
    normalised.partner_member_id = record.values.partner_member_id;
  }

  // Plain string fields: present as-is once non-empty.
  for (const field of ['first_name', 'last_name'] as CanonicalField[]) {
    const raw = record.values[field];
    if (raw !== undefined) {
      normalised[field] = raw;
    }
  }

  // Email format (only checked when present).
  if (record.values.email !== undefined) {
    if (EMAIL_RE.test(record.values.email)) {
      normalised.email = record.values.email;
    } else {
      rejections.push({ field: 'email', reason: 'invalid email format' });
    }
  }

  // Dates: parse + normalise to ISO-8601 per profile's date format.
  const isoDates: Partial<Record<CanonicalField, string>> = {};
  for (const field of DATE_FIELDS) {
    const raw = record.values[field];
    if (raw === undefined) continue; // already handled by presence check above
    const iso = parseDate(raw, profile.dateFormat);
    if (iso === null) {
      rejections.push({ field, reason: 'invalid date' });
    } else {
      isoDates[field] = iso;
      normalised[field] = iso;
    }
  }

  // DOB must be in the past.
  if (isoDates.date_of_birth !== undefined) {
    const today = new Date();
    const todayIso = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
    if (isoDates.date_of_birth >= todayIso) {
      rejections.push({ field: 'date_of_birth', reason: 'date_of_birth must be in the past' });
    }
  }

  // policy_end >= policy_start (only when both parsed successfully).
  if (isoDates.policy_start !== undefined && isoDates.policy_end !== undefined) {
    if (isoToUtcDate(isoDates.policy_end) < isoToUtcDate(isoDates.policy_start)) {
      rejections.push({ field: 'row', reason: 'policy_end before policy_start' });
    }
  }

  if (rejections.length > 0) {
    return { ok: false, rejections };
  }

  const member: CanonicalMember = {
    partner_id: profile.partnerId,
    partner_member_id: normalised.partner_member_id as string,
    first_name: normalised.first_name ?? null,
    last_name: normalised.last_name ?? null,
    date_of_birth: normalised.date_of_birth ?? null,
    email: normalised.email ?? null,
    policy_start: normalised.policy_start ?? null,
    policy_end: normalised.policy_end ?? null,
  };

  return { ok: true, member };
}

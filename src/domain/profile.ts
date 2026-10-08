import { CANONICAL_FIELDS, CanonicalField } from './member.js';

/** Supported raw date formats a source profile can declare. */
export type DateFormat = 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';

/**
 * Per-partner configuration. This is the *only* place partner differences
 * may live — column names, date format, which fields are required, and
 * validation overrides are all data here, never branches in the core
 * pipeline (`csv`, `validate`, `store`, `import`).
 */
export interface SourceProfile {
  /** Stable identifier supplied at import time (CLI flag / HTTP param). */
  partnerId: string;
  /** Human-readable name, for logs/reporting only. */
  displayName: string;
  /** Canonical field -> this partner's CSV column header. */
  columnMap: Record<CanonicalField, string>;
  /** Date format used by this partner's raw CSV for date fields. */
  dateFormat: DateFormat;
  /**
   * Canonical fields this partner's file may legitimately leave blank.
   * Everything in CANONICAL_FIELDS not listed here is required.
   */
  optionalFields?: CanonicalField[];
}

/** Resolve which canonical fields are required for a given profile. */
export function requiredFields(profile: SourceProfile): CanonicalField[] {
  const optional = new Set(profile.optionalFields ?? []);
  return CANONICAL_FIELDS.filter((f) => !optional.has(f));
}

import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { CANONICAL_FIELDS, CanonicalField } from '../domain/member.js';
import { SourceProfile } from '../domain/profile.js';

/**
 * A single CSV row with its raw (unvalidated, unparsed) string values
 * re-keyed from the partner's own column headers onto canonical field
 * names via the active profile's columnMap. `rowNumber` is 1-based and
 * counts data rows only (header excluded), for human-readable reporting.
 */
export interface RawRecord {
  rowNumber: number;
  values: Record<CanonicalField, string | undefined>;
}

/**
 * Read a partner's CSV file and re-key each row's columns onto canonical
 * field names using the profile's columnMap. This is the only place that
 * knows about a partner's actual column headers; everything downstream
 * only ever sees canonical field names.
 */
export function readCsv(filePath: string, profile: SourceProfile): RawRecord[] {
  const content = readFileSync(filePath, 'utf-8');

  const [headerRow]: string[][] = parse(content, {
    to_line: 1,
    trim: true,
  });
  const headerKeys = new Set(headerRow ?? []);
  const missingColumns = Object.values(profile.columnMap).filter(
    (header) => !headerKeys.has(header),
  );
  if (missingColumns.length > 0) {
    throw new Error(
      `Source profile "${profile.partnerId}" expects column(s) [${missingColumns.join(', ')}] which are missing from this file's header. Check that the right profile is being used for this file.`,
    );
  }

  const rows: Record<string, string>[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  return rows.map((row, index) => {
    const values = {} as Record<CanonicalField, string | undefined>;
    for (const field of CANONICAL_FIELDS) {
      const header = profile.columnMap[field];
      const raw = row[header];
      values[field] = raw === undefined || raw === '' ? undefined : raw;
    }
    return { rowNumber: index + 1, values };
  });
}

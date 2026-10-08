import { CanonicalMember } from '../domain/member.js';
import { SourceProfile } from '../domain/profile.js';
import { readCsv } from '../csv/reader.js';
import { Rejection, validateRecord } from '../validate/validate.js';
import { SqliteStore } from '../store/sqlite-store.js';

export interface RejectedRow {
  rowNumber: number;
  partnerMemberId?: string;
  rejections: Rejection[];
}

export interface DuplicateWarning {
  partnerMemberId: string;
  /** Row numbers sharing this id, in file order; the last one wins. */
  rowNumbers: number[];
}

export interface ImportSummary {
  partnerId: string;
  filePath: string;
  totalRows: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: RejectedRow[];
  duplicates: DuplicateWarning[];
}

/**
 * Run the full read -> validate -> upsert pipeline for one partner file.
 * One bad row is reported and skipped; it never aborts the rest of the
 * import. Duplicate partner_member_ids within the same file resolve
 * deterministically (last row in the file wins) and are reported as a
 * warning rather than silently dropped.
 */
export function runImport(
  filePath: string,
  profile: SourceProfile,
  store: SqliteStore,
): ImportSummary {
  const rawRecords = readCsv(filePath, profile);

  const rejected: RejectedRow[] = [];
  // Last-wins: a later valid row for the same id overwrites an earlier
  // one in this map, and the earlier entry is recorded in `duplicates`.
  const validByIdentity = new Map<string, { rowNumber: number; member: CanonicalMember }>();
  const duplicateRows = new Map<string, number[]>();

  for (const record of rawRecords) {
    const result = validateRecord(record, profile);
    if (!result.ok) {
      rejected.push({
        rowNumber: record.rowNumber,
        partnerMemberId: record.values.partner_member_id,
        rejections: result.rejections,
      });
      continue;
    }

    const key = result.member.partner_member_id;
    if (validByIdentity.has(key)) {
      const rows = duplicateRows.get(key) ?? [validByIdentity.get(key)!.rowNumber];
      rows.push(record.rowNumber);
      duplicateRows.set(key, rows);
    }
    validByIdentity.set(key, { rowNumber: record.rowNumber, member: result.member });
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const { member } of validByIdentity.values()) {
    const outcome = store.upsert(member);
    if (outcome === 'inserted') inserted++;
    else if (outcome === 'updated') updated++;
    else unchanged++;
  }

  const duplicates: DuplicateWarning[] = [...duplicateRows.entries()].map(
    ([partnerMemberId, rowNumbers]) => ({ partnerMemberId, rowNumbers }),
  );

  return {
    partnerId: profile.partnerId,
    filePath,
    totalRows: rawRecords.length,
    inserted,
    updated,
    unchanged,
    rejected,
    duplicates,
  };
}

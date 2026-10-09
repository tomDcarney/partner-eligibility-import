import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/store/sqlite-store.js';
import { runImport } from '../src/import/importer.js';
import { acmeInsuranceProfile } from '../src/profiles/acme-insurance.js';
import { beaconEmployerProfile } from '../src/profiles/beacon-employer.js';

const SAMPLE_ACME = join(process.cwd(), 'sample-data', 'acme-insurance.csv');
const SAMPLE_BEACON = join(process.cwd(), 'sample-data', 'beacon-employer.csv');

describe('runImport (integration)', () => {
  let dir: string;
  let store: SqliteStore;

  function freshStore() {
    dir = mkdtempSync(join(tmpdir(), 'perci-import-test-'));
    store = new SqliteStore(join(dir, 'members.db'));
  }

  afterEach(() => {
    store?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('first run: reports correct inserted/rejected counts with reasons', () => {
    freshStore();
    const summary = runImport(SAMPLE_ACME, acmeInsuranceProfile, store);

    expect(summary.totalRows).toBe(9);
    // AM-1001, AM-1002, AM-1008 (last-wins over the duplicate row) are valid.
    expect(summary.inserted).toBe(3);
    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(0);
    // AM-1003 (future DOB), 1004 (invalid date), 1005 (bad email),
    // 1006 (policy_end before start), 1007 (missing first_name).
    expect(summary.rejected).toHaveLength(5);

    const reasonsByField = summary.rejected.flatMap((r) => r.rejections.map((x) => x.reason));
    expect(reasonsByField).toContain('date_of_birth must be in the past');
    expect(reasonsByField).toContain('invalid date');
    expect(reasonsByField).toContain('invalid email format');
    expect(reasonsByField).toContain('policy_end before policy_start');
    expect(reasonsByField).toContain('missing required field');

    // In-file duplicate AM-1008 (rows 8 and 9) resolves deterministically
    // with a reported warning.
    expect(summary.duplicates).toHaveLength(1);
    expect(summary.duplicates[0]).toEqual({ partnerMemberId: 'AM-1008', rowNumbers: [8, 9] });

    // Last-wins: the stored row has the second occurrence's email.
    const stored = store.findByIdentity('acme-insurance', 'AM-1008');
    expect(stored?.email).toBe('frank.blue.updated@example.com');
  });

  it('second run on the same unchanged file: 0 inserted, 0 updated, N unchanged', () => {
    freshStore();
    runImport(SAMPLE_ACME, acmeInsuranceProfile, store);
    const second = runImport(SAMPLE_ACME, acmeInsuranceProfile, store);

    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(3);
    expect(second.rejected).toHaveLength(5);
  });

  it('third run with one row edited: exactly one update', () => {
    freshStore();
    const original = readFileSync(SAMPLE_ACME, 'utf-8');
    const editedPath = join(dir, 'acme-edited.csv');

    runImport(SAMPLE_ACME, acmeInsuranceProfile, store);

    const edited = original.replace('Jane,Doe,1985-03-14', 'Jane,Doeherty,1985-03-14');
    writeFileSync(editedPath, edited, 'utf-8');

    const third = runImport(editedPath, acmeInsuranceProfile, store);
    expect(third.inserted).toBe(0);
    expect(third.updated).toBe(1);
    expect(third.unchanged).toBe(2);

    expect(store.findByIdentity('acme-insurance', 'AM-1001')?.last_name).toBe('Doeherty');
  });

  it('lookup returns the stored member and null on a miss', () => {
    freshStore();
    runImport(SAMPLE_ACME, acmeInsuranceProfile, store);

    expect(store.findByIdentity('acme-insurance', 'AM-1001')).not.toBeNull();
    expect(store.findByIdentity('acme-insurance', 'does-not-exist')).toBeNull();
  });

  it('a second source profile with different columns/date format imports through the same pipeline', () => {
    freshStore();
    const summary = runImport(SAMPLE_BEACON, beaconEmployerProfile, store);

    expect(summary.totalRows).toBe(3);
    expect(summary.inserted).toBe(3);
    expect(summary.rejected).toHaveLength(0);

    const grace = store.findByIdentity('beacon-employer', 'BE-2001');
    expect(grace?.date_of_birth).toBe('1960-12-09'); // normalised from DD/MM/YYYY
    const ada = store.findByIdentity('beacon-employer', 'BE-2002');
    expect(ada?.email).toBeNull(); // optional field, left blank in source file
  });
});

import { describe, expect, it } from 'vitest';
import { validateRecord } from '../src/validate/validate.js';
import { acmeInsuranceProfile } from '../src/profiles/acme-insurance.js';
import { beaconEmployerProfile } from '../src/profiles/beacon-employer.js';
import { CanonicalField } from '../src/domain/member.js';
import { RawRecord } from '../src/csv/reader.js';

function record(
  values: Partial<Record<CanonicalField, string>>,
  rowNumber = 1,
): RawRecord {
  const full: Record<CanonicalField, string | undefined> = {
    partner_member_id: values.partner_member_id,
    first_name: values.first_name,
    last_name: values.last_name,
    date_of_birth: values.date_of_birth,
    email: values.email,
    policy_start: values.policy_start,
    policy_end: values.policy_end,
  };
  return { rowNumber, values: full };
}

const VALID = {
  partner_member_id: 'AM-1',
  first_name: 'Jane',
  last_name: 'Doe',
  date_of_birth: '1985-03-14',
  email: 'jane.doe@example.com',
  policy_start: '2024-01-01',
  policy_end: '2025-12-31',
};

describe('validateRecord', () => {
  it('accepts a fully valid row', () => {
    const result = validateRecord(record(VALID), acmeInsuranceProfile);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.member).toEqual({
        partner_id: 'acme-insurance',
        partner_member_id: 'AM-1',
        first_name: 'Jane',
        last_name: 'Doe',
        date_of_birth: '1985-03-14',
        email: 'jane.doe@example.com',
        policy_start: '2024-01-01',
        policy_end: '2025-12-31',
      });
    }
  });

  it('rejects a missing required field', () => {
    const { partner_member_id, first_name, last_name, date_of_birth, email, policy_start, policy_end } = VALID;
    const row = record({
      partner_member_id,
      last_name,
      date_of_birth,
      email,
      policy_start,
      policy_end,
    });
    const result = validateRecord(row, acmeInsuranceProfile);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejections).toContainEqual({
        field: 'first_name',
        reason: 'missing required field',
      });
    }
  });

  it('rejects a malformed/invalid calendar date', () => {
    const row = record({ ...VALID, date_of_birth: '1978-02-30' });
    const result = validateRecord(row, acmeInsuranceProfile);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejections).toContainEqual({
        field: 'date_of_birth',
        reason: 'invalid date',
      });
    }
  });

  it('rejects garbage date text', () => {
    const row = record({ ...VALID, date_of_birth: 'garbage' });
    const result = validateRecord(row, acmeInsuranceProfile);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejections).toContainEqual({
        field: 'date_of_birth',
        reason: 'invalid date',
      });
    }
  });

  it('rejects a future date_of_birth', () => {
    const row = record({ ...VALID, date_of_birth: '2099-01-01' });
    const result = validateRecord(row, acmeInsuranceProfile);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejections).toContainEqual({
        field: 'date_of_birth',
        reason: 'date_of_birth must be in the past',
      });
    }
  });

  it('rejects policy_end before policy_start', () => {
    const row = record({ ...VALID, policy_start: '2025-01-01', policy_end: '2024-01-01' });
    const result = validateRecord(row, acmeInsuranceProfile);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejections).toContainEqual({
        field: 'row',
        reason: 'policy_end before policy_start',
      });
    }
  });

  it('rejects an invalid email format', () => {
    const row = record({ ...VALID, email: 'not-an-email' });
    const result = validateRecord(row, acmeInsuranceProfile);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejections).toContainEqual({
        field: 'email',
        reason: 'invalid email format',
      });
    }
  });

  it('reports every failing field, not just the first', () => {
    const row = record({ ...VALID, email: 'not-an-email', date_of_birth: 'garbage' });
    const result = validateRecord(row, acmeInsuranceProfile);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejections).toHaveLength(2);
    }
  });

  it('parses DD/MM/YYYY dates for a profile that declares that format', () => {
    const row = record({
      partner_member_id: 'BE-1',
      first_name: 'Grace',
      last_name: 'Hopper',
      date_of_birth: '09/12/1960',
      email: 'grace@example.com',
      policy_start: '01/01/2024',
      policy_end: '31/12/2025',
    });
    const result = validateRecord(row, beaconEmployerProfile);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.member.date_of_birth).toBe('1960-12-09');
      expect(result.member.policy_start).toBe('2024-01-01');
      expect(result.member.policy_end).toBe('2025-12-31');
    }
  });

  it('allows a missing optional field (email) per profile override', () => {
    const row = record({
      partner_member_id: 'BE-2',
      first_name: 'Ada',
      last_name: 'Lovelace',
      date_of_birth: '27/12/1975',
      policy_start: '01/01/2024',
      policy_end: '31/12/2025',
    });
    const result = validateRecord(row, beaconEmployerProfile);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.member.email).toBeNull();
    }
  });

  it('parses MM/DD/YYYY dates for a profile declaring that format', () => {
    const mmddyyyyProfile = { ...beaconEmployerProfile, dateFormat: 'MM/DD/YYYY' as const };
    const row = record({
      partner_member_id: 'BE-3',
      first_name: 'Grace',
      last_name: 'Hopper',
      date_of_birth: '12/09/1960', // December 9th
      email: 'grace@example.com',
      policy_start: '01/15/2024', // January 15th
      policy_end: '12/31/2025', // December 31st
    });
    const result = validateRecord(row, mmddyyyyProfile);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.member.date_of_birth).toBe('1960-12-09');
      expect(result.member.policy_start).toBe('2024-01-15');
      expect(result.member.policy_end).toBe('2025-12-31');
    }
  });
});

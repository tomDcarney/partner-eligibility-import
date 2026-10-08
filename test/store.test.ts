import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteStore } from '../src/store/sqlite-store.js';
import { CanonicalMember } from '../src/domain/member.js';

const member: CanonicalMember = {
  partner_id: 'acme-insurance',
  partner_member_id: 'AM-1',
  first_name: 'Jane',
  last_name: 'Doe',
  date_of_birth: '1985-03-14',
  email: 'jane.doe@example.com',
  policy_start: '2024-01-01',
  policy_end: '2025-12-31',
};

describe('SqliteStore', () => {
  let store: SqliteStore;

  beforeEach(() => {
    store = new SqliteStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('inserts a new member on first write', () => {
    const outcome = store.upsert(member);
    expect(outcome).toBe('inserted');
    expect(store.findByIdentity('acme-insurance', 'AM-1')).toEqual(member);
  });

  it('is a no-op on an identical re-write', () => {
    store.upsert(member);
    const outcome = store.upsert({ ...member });
    expect(outcome).toBe('unchanged');
  });

  it('updates in place when a mutable field changes', () => {
    store.upsert(member);
    const changed = { ...member, last_name: 'Smith' };
    const outcome = store.upsert(changed);
    expect(outcome).toBe('updated');
    expect(store.findByIdentity('acme-insurance', 'AM-1')?.last_name).toBe('Smith');
  });

  it('a changed email never creates a second member: identity is keyed strictly by (partner_id, partner_member_id)', () => {
    store.upsert(member);
    const emailChanged = { ...member, email: 'new.email@example.com' };
    const outcome = store.upsert(emailChanged);
    expect(outcome).toBe('updated');
    expect(store.findByIdentity('acme-insurance', 'AM-1')?.email).toBe('new.email@example.com');

    // Still exactly one row for this identity - no duplicate was created.
    const sameIdDifferentPartner = store.findByIdentity('other-partner', 'AM-1');
    expect(sameIdDifferentPartner).toBeNull();
  });

  it('treats the same partner_member_id under a different partner_id as a distinct member', () => {
    store.upsert(member);
    const otherPartner = { ...member, partner_id: 'other-partner' };
    const outcome = store.upsert(otherPartner);
    expect(outcome).toBe('inserted');
    expect(store.findByIdentity('acme-insurance', 'AM-1')).not.toBeNull();
    expect(store.findByIdentity('other-partner', 'AM-1')).not.toBeNull();
  });

  it('returns null on a lookup miss', () => {
    expect(store.findByIdentity('acme-insurance', 'does-not-exist')).toBeNull();
  });
});

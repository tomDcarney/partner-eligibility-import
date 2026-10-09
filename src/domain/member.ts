/**
 * Canonical member record. Every source profile maps its partner-specific
 * CSV onto this shape before the core pipeline ever sees it.
 *
 * Member identity is the composite (partner_id, partner_member_id) — see
 * `memberIdentity`. It is explicit and stable: a changed email (or any
 * other field) never creates a second member, because identity never
 * depends on mutable fields.
 */
export interface CanonicalMember {
  partner_id: string;
  partner_member_id: string;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null; // ISO-8601 YYYY-MM-DD
  email: string | null;
  policy_start: string | null; // ISO-8601 YYYY-MM-DD
  policy_end: string | null; // ISO-8601 YYYY-MM-DD
}

/** The canonical field set every source profile maps onto. */
export const CANONICAL_FIELDS = [
  'partner_member_id',
  'first_name',
  'last_name',
  'date_of_birth',
  'email',
  'policy_start',
  'policy_end',
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

export interface MemberIdentity {
  partner_id: string;
  partner_member_id: string;
}

/**
 * Stable, explicit member identity. Deliberately excludes every mutable
 * field (name, email, dates) so that editing any of them updates the
 * existing member instead of creating a new one.
 */
export function memberIdentity(member: {
  partner_id: string;
  partner_member_id: string;
}): MemberIdentity {
  return {
    partner_id: member.partner_id,
    partner_member_id: member.partner_member_id,
  };
}

/** Identity as a single string key, convenient for map/set dedupe. */
export function identityKey(identity: MemberIdentity): string {
  return `${identity.partner_id}\u0000${identity.partner_member_id}`;
}

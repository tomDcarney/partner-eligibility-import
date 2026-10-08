import { SourceProfile } from '../domain/profile.js';

/**
 * "acme-insurance" — the canonical-shaped partner. Column headers match
 * the canonical field names exactly and dates are already ISO-8601.
 * All seven fields are required (the default).
 */
export const acmeInsuranceProfile: SourceProfile = {
  partnerId: 'acme-insurance',
  displayName: 'Acme Insurance',
  dateFormat: 'YYYY-MM-DD',
  columnMap: {
    partner_member_id: 'partner_member_id',
    first_name: 'first_name',
    last_name: 'last_name',
    date_of_birth: 'date_of_birth',
    email: 'email',
    policy_start: 'policy_start',
    policy_end: 'policy_end',
  },
};

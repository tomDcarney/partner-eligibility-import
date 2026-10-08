import { SourceProfile } from '../domain/profile.js';

/**
 * "beacon-employer" — an employer partner whose file uses different
 * column headers, DD/MM/YYYY dates, and leaves email optional (some
 * members have no email on file). Demonstrates that a second partner
 * with a differently-shaped file imports through the same core pipeline
 * with zero code changes — only this configuration differs.
 */
export const beaconEmployerProfile: SourceProfile = {
  partnerId: 'beacon-employer',
  displayName: 'Beacon Employer Group',
  dateFormat: 'DD/MM/YYYY',
  columnMap: {
    partner_member_id: 'EmployeeID',
    first_name: 'GivenName',
    last_name: 'Surname',
    date_of_birth: 'DOB',
    email: 'EmailAddress',
    policy_start: 'CoverStart',
    policy_end: 'CoverEnd',
  },
  optionalFields: ['email'],
};

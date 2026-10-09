import { SourceProfile } from '../domain/profile.js';
import { acmeInsuranceProfile } from './acme-insurance.js';
import { beaconEmployerProfile } from './beacon-employer.js';

/** All known source profiles, keyed by partnerId. */
const PROFILES: Record<string, SourceProfile> = {
  [acmeInsuranceProfile.partnerId]: acmeInsuranceProfile,
  [beaconEmployerProfile.partnerId]: beaconEmployerProfile,
};

export class UnknownPartnerError extends Error {
  constructor(partnerId: string) {
    super(
      `Unknown partner "${partnerId}". Known partners: ${Object.keys(PROFILES).join(', ')}`,
    );
    this.name = 'UnknownPartnerError';
  }
}

/** Look up a partner's source profile by partnerId. Throws if unknown. */
export function loadProfile(partnerId: string): SourceProfile {
  const profile = PROFILES[partnerId];
  if (!profile) {
    throw new UnknownPartnerError(partnerId);
  }
  return profile;
}

export { acmeInsuranceProfile, beaconEmployerProfile };

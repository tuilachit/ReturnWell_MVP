// Release-controlled evidence, not a client flag or an environment-variable
// substitute for human review. Add only actual, approved evidence references.
export type PilotEvidence = {
  approvalReference: string | null;
  businessName: string | null;
  supportEmail: string | null;
  termsVersion: string | null;
  privacyVersion: string | null;
  noticesPublished: boolean;
  clinicalProtocol: string | null;
  privacyReview: string | null;
  retentionReview: string | null;
  recoveryRehearsal: string | null;
  monitoringOwner: string | null;
  mailboxAcceptance: string | null;
  directAuthAbuseReview: string | null;
};
export const pilotEvidence: PilotEvidence = {
  approvalReference: null,
  businessName: null,
  supportEmail: null,
  termsVersion: null,
  privacyVersion: null,
  noticesPublished: false,
  clinicalProtocol: null,
  privacyReview: null,
  retentionReview: null,
  recoveryRehearsal: null,
  monitoringOwner: null,
  mailboxAcceptance: null,
  directAuthAbuseReview: null,
};

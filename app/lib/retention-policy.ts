export type RetentionPolicy = {
  recordClass: string;
  keepForDays: number;
  legalHoldBehaviour: "retain";
  approvedBy: string;
  approvedAt: string;
};
// Decision guard only. No scheduled purge or approved clinical duration exists.
export function canPurgeRecord(
  policy: RetentionPolicy | null,
  createdAt: string,
  legalHold: boolean,
  now = Date.now(),
) {
  if (
    legalHold ||
    !policy ||
    policy.legalHoldBehaviour !== "retain" ||
    !policy.recordClass?.trim() ||
    !policy.approvedBy?.trim() ||
    !Number.isInteger(policy.keepForDays) ||
    policy.keepForDays < 1
  )
    return false;
  const approved = Date.parse(policy.approvedAt),
    created = Date.parse(createdAt);
  return (
    Number.isFinite(approved) &&
    approved <= now &&
    Number.isFinite(created) &&
    created <= now &&
    now - created >= policy.keepForDays * 86400000
  );
}

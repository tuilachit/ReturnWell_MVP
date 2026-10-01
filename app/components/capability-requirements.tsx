import { normalizeTerm } from "../lib/terminology";
// Used inside referral definition lists on both sides of the handover.
export default function CapabilityRequirements({
  services = [],
  ageGroup = "",
}: {
  services?: string[];
  ageGroup?: string | null;
}) {
  return (
    <>
      {services.length > 0 && (
        <div>
          <dt>Required services</dt>
          <dd>
            {services
              .map(
                (id) =>
                  normalizeTerm("service", id)?.label ?? `${id} (unrecognised)`,
              )
              .join(", ")}
          </dd>
        </div>
      )}
      {ageGroup && (
        <div>
          <dt>Required age group</dt>
          <dd>
            {normalizeTerm("ageGroup", ageGroup)?.label ??
              `${ageGroup} (unrecognised)`}
          </dd>
        </div>
      )}
    </>
  );
}

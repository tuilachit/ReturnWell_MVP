import type { DirectoryPage, DistanceGroup } from "../lib/directory";
export default function DirectoryPages({
  page,
  group,
  busy,
  onGroup,
  onNext,
  onFirst,
  hasCursor,
  telehealthOnly = false,
}: {
  page: DirectoryPage;
  group: DistanceGroup;
  busy: boolean;
  onGroup: (group: DistanceGroup) => void;
  onNext: () => void;
  onFirst: () => void;
  hasCursor: boolean;
  telehealthOnly?: boolean;
}) {
  return (
    <div>
      <div
        className="form-actions"
        role="group"
        aria-label="Appointment options"
      >
        {!telehealthOnly && page.geography?.origin?.hasCoordinates && (
          <button type="button" className="button secondary" aria-pressed={group === "local"} disabled={busy} onClick={() => onGroup("local")}>
            Nearby options ({page.groupCounts.local})
          </button>
        )}
        {!telehealthOnly && (
          <button
            type="button"
            className="button secondary"
            aria-pressed={group === "unknown"}
            disabled={busy}
            onClick={() => onGroup("unknown")}
          >
            {page.geography?.origin?.hasCoordinates ? "Distance unavailable" : "In-person options"} ({page.groupCounts.unknown})
          </button>
        )}
        <button
          type="button"
          className="button secondary"
          aria-pressed={group === "remote"}
          disabled={busy}
          onClick={() => onGroup("remote")}
        >
          {telehealthOnly ? "Telehealth" : "Telehealth-only options"} (
          {page.groupCounts.remote})
        </button>
      </div>
      <p>
        {busy
          ? "Loading this page…"
          : `${page.items.length} shown · ${page.totalEligible} eligible in this group`}
        . {telehealthOnly ? "Distance does not affect telehealth ordering." : page.geography?.origin?.hasCoordinates
          ? `Approximate straight-line distance from ${page.geography.origin.suburb} ${page.geography.origin.postcode}${page.geography.radiusKm ? `, within ${page.geography.radiusKm} km` : ""}. Not driving distance.`
          : "Choose a supported patient suburb to sort by distance; otherwise browse by suburb/postcode."}
      </p>
      {page.geography?.origin?.hasCoordinates && page.geography.source && !telehealthOnly && (
        <p className="location-note">Reference: <a href={page.geography.source.url} target="_blank" rel="noreferrer">{page.geography.source.attribution}</a> · {page.geography.source.version} · {page.geography.source.license}</p>
      )}
      {!busy && group === "local" && page.totalEligible === 0 && <p>No eligible practices within this search. Widen the radius, or check distance-unavailable and telehealth options. The radius has not been widened automatically.</p>}
      <div className="form-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy || !hasCursor}
          onClick={onFirst}
        >
          First page
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy || !page.nextCursor}
          onClick={onNext}
        >
          Next page
        </button>
      </div>
    </div>
  );
}

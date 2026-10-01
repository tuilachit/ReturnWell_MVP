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
        {!telehealthOnly && (
          <button
            type="button"
            className="button secondary"
            aria-pressed={group === "unknown"}
            disabled={busy}
            onClick={() => onGroup("unknown")}
          >
            In-person options ({page.groupCounts.unknown})
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
        . Distance and radius filtering are unavailable until approved reference
        data is configured.
      </p>
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

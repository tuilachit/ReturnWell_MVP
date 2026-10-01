export default function PageState({
  kind,
  title,
  description,
  onRetry,
}: {
  kind: "loading" | "empty" | "error";
  title: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <section
      className={`page-state page-state-${kind}`}
      role={kind === "error" ? "alert" : "status"}
      aria-busy={kind === "loading"}
    >
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {onRetry && (
        <button className="button secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </section>
  );
}

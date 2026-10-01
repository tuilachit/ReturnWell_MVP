export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-mark ${className}`} aria-hidden="true">
      <svg viewBox="0 0 40 40" fill="none">
        <path
          d="M12.5 29V14a5 5 0 0 1 5-5h3a6.5 6.5 0 0 1 0 13h-8"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="m20 22 7 7"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function Brand() {
  return (
    <span className="brand">
      <BrandMark />
      <span>ReturnWell</span>
    </span>
  );
}

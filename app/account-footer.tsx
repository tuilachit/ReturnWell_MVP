/* Full navigation keeps public notices separate from workspace state. */
import { LockKeyhole } from "./ui-icons";

export default function AccountFooter() {
  return (
    <footer className="account-footer">
      <span>
        <LockKeyhole size={13} />
        Private test · Fictional data only · Not for clinical use
      </span>
      <nav aria-label="Test information">
        <a href="/privacy">Privacy notice (draft)</a>
        <a href="/terms">Test terms (draft)</a>
        <a href="/support">Support</a>
      </nav>
    </footer>
  );
}

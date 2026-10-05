import AuthGate from "../../auth-gate";
export default function CandidateReviewPage() {
  return <AuthGate requested="candidates" />;
}

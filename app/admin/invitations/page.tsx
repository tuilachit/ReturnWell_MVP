import AuthGate from "../../auth-gate";
export default function StaffInvitationsPage() {
  return <AuthGate requested="staffInvitations" />;
}

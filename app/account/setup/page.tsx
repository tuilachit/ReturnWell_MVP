import AuthGate from "../../auth-gate";
export default function AccountSetupPage() {
  return <AuthGate requested="setup" />;
}

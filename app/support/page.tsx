import WorkflowShell from "../workflow-shell";
import { testSupportEmail } from "../test-policy";
export default function SupportPage() {
  return (
    <WorkflowShell title="Support" compact>
      <p>
        ReturnWell is currently a private technical test using fictional
        referral data. It is not an urgent-care or emergency service.
      </p>
      <section className="workflow-card">
        <h2>Contact the test organiser</h2>
        <p>
          <a href={`mailto:${testSupportEmail}`}>{testSupportEmail}</a>
        </p>
        <p>
          Describe the screen, approximate time and the action that failed. Do
          not include patient information, clinical summaries, passwords,
          invitation links, verification codes or authenticator keys. This link
          does not attach application data.
        </p>
        <p>
          A monitored pilot support address, support owner and response
          arrangements still require approval. No response time is promised for
          this test.
        </p>
      </section>
      <section className="workflow-card">
        <h2>Account or privacy request</h2>
        <p>
          Ask the organiser for account-access recovery, correction, access to
          your records, deletion or withdrawal from testing. Identity and
          authority must be checked before action. Signing out does not delete
          server records; legal holds and backups may limit deletion.
        </p>
      </section>
      <section className="workflow-card">
        <h2>If a referral or email looks stuck</h2>
        <p>
          Check its saved status before submitting again. Queued, sent and
          delivered are different from a practitioner accepting the referral. Do
          not resend an uncertain action using a new request or copy patient
          details into email.
        </p>
        <p>
          For urgent clinical matters, use your established clinical and
          emergency channels outside ReturnWell.
        </p>
      </section>
      <a href="/security">Account security</a>
    </WorkflowShell>
  );
}

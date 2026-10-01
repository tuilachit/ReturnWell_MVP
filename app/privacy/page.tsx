import type { Metadata } from "next";
import TestPolicy from "../test-policy";

export const metadata: Metadata = {
  title: "Privacy notice draft | ReturnWell Test",
  description: "Draft privacy notice for a closed, fictional-data technical test.",
  robots: { index: false, follow: false },
};

export default function PrivacyPage() {
  return (
    <TestPolicy title="Privacy notice">
      <h2>Who this test is for</h2>
      <p>
        ReturnWell Test is the working name for an invitation-only test run by
        the test organiser. It is not a statement of a registered legal entity.
        The current email test is restricted to the organiser’s approved
        mailbox. A broader pilot needs a confirmed operator identity and
        reviewed privacy arrangements first.
      </p>
      <h2>Information used in the test</h2>
      <p>
        Account email addresses and account identifiers are real. Invitation
        records, consent versions and timestamps, test profiles, fictional
        referrals and workflow history may be stored to exercise the app.
        Delivery records can include recipient addresses, provider message IDs,
        delivery failures and suppression status. Hosting and authentication
        services may also keep technical access and security logs.
      </p>
      <p>
        Use fictional names and content for practice, practitioner and referral
        examples. Do not enter real patient details, health records, third-party
        contact details or real practitioner registration numbers. If you add
        real information accidentally, stop testing and contact the organiser.
      </p>
      <h2>Why it is used and who can receive it</h2>
      <p>
        This information supports account verification, invitation and referral
        workflow testing, delivery tracking, troubleshooting and abuse
        prevention. Test records can be visible to authorised participants in
        the relevant workflow and to authorised technical administrators.
      </p>
      <p>
        The setup uses Supabase for authentication and database services,
        Vercel for web hosting and Resend for application email. The receiving
        mailbox provider also handles delivered email. Provider processing and
        support may occur outside Australia; the complete country list,
        provider terms and retention arrangements still need review before
        any broader pilot. No claim of Australia-only processing is made here.
      </p>
      <h2>Storage, access and requests</h2>
      <p>
        The browser stores authentication session information. The app records
        consent and workflow history; closing a browser or signing out does not delete
        server records. A final retention schedule and deletion process have
        not yet been approved. Do not assume automatic deletion after a set
        number of days or immediate removal from provider logs and backups.
      </p>
      <p>
        Contact the organiser to request access, correction, deletion, withdrawal
        from testing or to raise a privacy concern. The organiser will need to
        verify the request and explain the available action and any limitations.
        These procedures must be reviewed before collecting real clinical data.
      </p>
    </TestPolicy>
  );
}

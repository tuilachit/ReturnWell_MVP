import type { Metadata } from "next";
import TestPolicy from "../test-policy";

export const metadata: Metadata = {
  title: "Test terms draft | ReturnWell Test",
  description: "Draft participation terms for the ReturnWell private technical test.",
  robots: { index: false, follow: false },
};

export default function TermsPage() {
  return (
    <TestPolicy title="Test terms">
      <h2>A technical test, not clinical care</h2>
      <p>
        The proposed test covers invitations, account access, fictional
        practitioner profiles, fictional referrals and email delivery. It does
        not provide clinical care, medical advice, appointments or emergency
        assistance. Do not use its directory, matching results or workflow
        statuses to make decisions about a real patient.
      </p>
      <h2>Use your own invited account</h2>
      <p>
        Use only the mailbox approved for this test. Keep invitation and
        sign-in links private, and do not forward them or share an authenticated
        session. An account or test review status is not evidence of professional
        identity, AHPRA registration or suitability to provide care.
      </p>
      <h2>Fictional records only</h2>
      <p>
        Do not enter real patient information, upload clinical documents, use
        another person’s contact details or send invitations to practitioners
        collected from public websites. Test profiles and referrals must be
        clearly fictional. Do not use the test for unsolicited outreach,
        impersonation or attempts to access another user’s information.
      </p>
      <h2>Emails and workflow status</h2>
      <p>
        Application emails are intended for the approved test mailbox only.
        Queued or sent status does not establish delivery; delivered status
        does not establish that anyone read the message. Test acceptance of a
        referral is not a real care arrangement. Do not put clinical details
        into email replies or support requests.
      </p>
      <h2>Participation and unfinished features</h2>
      <p>
        Participation is voluntary. You can stop and contact the organiser
        about your account and test records. The software is unfinished;
        features and test availability may change. Do not rely on it as a
        production record system. Broader access, real clinical use and public
        launch require separate approval and readiness checks.
      </p>
      <h2>Review before use</h2>
      <p>
        These terms and the accompanying privacy notice are drafts for owner
        review. They are not a substitute for final business details, reviewed
        operating procedures or legal advice. Preparing these pages does not
        itself authorise emails or create an account.
      </p>
    </TestPolicy>
  );
}

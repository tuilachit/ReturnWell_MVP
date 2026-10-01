import {
  ArrowRight,
  Check,
  Send,
  ReferralIcon as ClipboardList,
  PeopleIcon as Users,
} from "./ui-icons";

const steps = [
  {
    icon: ClipboardList,
    title: "Start with the need",
    text: "Use your practice’s patient reference, then add the reason for referral, funding pathway and appointment preferences.",
  },
  {
    icon: Users,
    title: "Choose the right fit",
    text: "Review the eligible practitioners and their practice locations. Distance ranking is not available yet. You make the final choice.",
  },
  {
    icon: Send,
    title: "Review the handover",
    text: "Check the details and confirm patient consent before recording the referral. Email delivery status is shown separately.",
  },
  {
    icon: Check,
    title: "Follow the response",
    text: "Track acceptance or decline in activity. After acceptance, use the reviewed referring-practice contact to agree a secure external handover. Arrange appointments and payments separately; close coordination only after confirming the actual outcome.",
  },
];

export default function ReferralGuide({ onNew }: { onNew: () => void }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Referral guide</h1>
          <p>
            Create a referral, choose a practitioner and track the response.
          </p>
        </div>
      </div>
      <section className="guide-steps">
        {steps.map(({ icon: Icon, title, text }, index) => (
          <article key={title}>
            <span className="guide-step-number">0{index + 1}</span>
            <div>
              <Icon size={23} />
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
          </article>
        ))}
      </section>
      <div className="guide-start">
        <p>Ready for your next handover?</p>
        <button className="button primary" onClick={onNew}>
          New referral <ArrowRight size={16} />
        </button>
      </div>
    </>
  );
}

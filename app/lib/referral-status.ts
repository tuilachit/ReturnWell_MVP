export function referralStatusLabel(status: string): string {
  return (
    (
      {
        sent: "Awaiting response",
        accepted: "Accepted — arrange handover",
        declined: "Needs another option",
        booked: "Previously recorded as booked",
        cancelled: "Cancelled",
        closed: "Closed",
        awaiting_onboarding: "Awaiting practitioner onboarding",
      } as Record<string, string>
    )[status] ?? "Status unavailable"
  );
}

"use client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import WorkflowShell from "./workflow-shell";
import PractitionerProfile from "./practitioner-profile";
import ReferralActivity from "./referral-activity";
import { errorText, invoke, requestId } from "./lib/workflow";
type Assigned = {
  id: string;
  reference: string;
  patient_reference: string;
  patient_postcode: string;
  clinical_summary: string;
  funding_path: string;
  appointment_format: string;
  language_or_access: string | null;
  status: string;
  version: number;
};
export default function PractitionerInbox({
  client,
  practitioner,
}: {
  client: SupabaseClient;
  practitioner: {
    practitionerId: string;
    displayName: string;
    acceptingNewReferrals: boolean;
  };
}) {
  const [rows, setRows] = useState<Assigned[]>([]);
  const [selected, setSelected] = useState<string | null>(() =>
    typeof window !== "undefined"
      ? window.location.pathname.match(
          /^\/referrals\/([0-9a-f-]{36})$/i,
        )?.[1] || null
      : null,
  );
  const [tab, setTab] = useState("sent");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [available, setAvailable] = useState(
    practitioner.acceptingNewReferrals,
  );
  const pending = useRef<{
    fingerprint: string;
    id: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    let run = 0;
    async function load() {
      const version = ++run;
      const { data, error } = await client
        .from("referrals")
        .select(
          "id,reference,patient_reference,patient_postcode,clinical_summary,funding_path,appointment_format,language_or_access,status,version",
        )
        .eq("selected_practitioner_id", practitioner.practitionerId)
        .order("created_at", { ascending: false });
      if (!active || version !== run) return;
      setLoading(false);
      if (error) {
        setRows([]);
        setMessage(
          "Referrals are unavailable. Please check your workspace access.",
        );
      } else setRows((data || []) as Assigned[]);
    }
    void load();
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", visible);
    const timer = window.setInterval(visible, 30000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", visible);
    };
  }, [client, practitioner.practitionerId, refresh]);
  const detail = rows.find((row) => row.id === selected);
  async function respond(decision: "accepted" | "declined") {
    if (!detail) return;
    setBusy(true);
    setMessage("");
    const payload = {
      referralId: detail.id,
      expectedVersion: detail.version,
      decision,
      ...(decision === "declined"
        ? { reasonCode: reason, note: note.trim() }
        : {}),
    };
    const fingerprint = JSON.stringify(payload);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, id: requestId() };
    try {
      const result = await invoke<{
        referralId: string;
        status: string;
        version: number;
        notification: string;
      }>(client, "respond-to-referral", {
        ...payload,
        requestId: pending.current.id,
      });
      setRows((current) =>
        current.map((row) =>
          row.id === result.referralId
            ? { ...row, status: result.status, version: result.version }
            : row,
        ),
      );
      setMessage(
        `Response saved. ${result.notification === "configuration_needed" ? "The practice notification needs delivery configuration." : result.notification === "suppressed" ? "Email notification is suppressed." : "Email notification is pending."} Acceptance does not mean an appointment is booked.`,
      );
      setDeclining(false);
      setRefresh((value) => value + 1);
      pending.current = null;
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkflowShell title={`${practitioner.displayName} — referrals`}>
      <PractitionerProfile
        client={client}
        practitionerId={practitioner.practitionerId}
      />
      <label className="workflow-check">
        <input
          type="checkbox"
          checked={available}
          disabled={busy}
          onChange={async (event) => {
            const next = event.target.checked;
            setBusy(true);
            try {
              await invoke(client, "practitioner-onboarding", {
                operation: "availability",
                practitionerId: practitioner.practitionerId,
                acceptingNewReferrals: next,
              });
              setAvailable(next);
              setMessage(
                next
                  ? "New referrals enabled."
                  : "New referrals paused. Existing assignments remain available.",
              );
            } catch (error) {
              setMessage(errorText(error));
            } finally {
              setBusy(false);
            }
          }}
        />
        Accepting new referrals
      </label>
      <p>
        Identity and registration changes require a reviewed profile update.
        Contact ReturnWell support using your invitation.
      </p>
      <button
        className="button secondary"
        disabled={busy}
        onClick={() => setRefresh((value) => value + 1)}
      >
        Refresh referrals
      </button>
      {message && <p role="status">{message}</p>}
      {selected ? (
        loading ? (
          <p>Loading referral…</p>
        ) : detail ? (
          <section className="workflow-card">
            <button
              className="button secondary"
              onClick={() => {
                setSelected(null);
                setDeclining(false);
                setNote("");
                setReason("");
              }}
            >
              Back to inbox
            </button>
            <h2>
              {detail.reference} · {detail.patient_reference}
            </h2>
            <p>
              Status:{" "}
              {detail.status === "sent" ? "Awaiting response" : detail.status}
            </p>
            <dl>
              <div>
                <dt>Clinical need</dt>
                <dd>{detail.clinical_summary}</dd>
              </div>
              <div>
                <dt>Postcode</dt>
                <dd>{detail.patient_postcode}</dd>
              </div>
              <div>
                <dt>Funding and format</dt>
                <dd>
                  {detail.funding_path} ·{" "}
                  {detail.appointment_format.replaceAll("_", " ")}
                </dd>
              </div>
              <div>
                <dt>Language and access</dt>
                <dd>{detail.language_or_access || "Not specified"}</dd>
              </div>
            </dl>
            {detail.status === "sent" && (
              <>
                <p>
                  Accepting means you agree to handle this referral. It does not
                  book an appointment.
                </p>
                <div className="workflow-actions">
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void respond("accepted")}
                  >
                    Accept referral
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setDeclining(true)}
                  >
                    Decline referral
                  </button>
                </div>
                {declining && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void respond("declined");
                    }}
                  >
                    <label>
                      Reason for declining
                      <select
                        required
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      >
                        <option value="" disabled>
                          Select a reason
                        </option>
                        <option value="capacity">No capacity</option>
                        <option value="service_not_offered">
                          Service not offered
                        </option>
                        <option value="funding_not_supported">
                          Funding not supported
                        </option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label>
                      Note to the referring practice (optional)
                      <textarea
                        maxLength={500}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                      />
                    </label>
                    <p>
                      This note is visible to referral participants. It is not
                      included in email.
                    </p>
                    <button className="button primary" disabled={busy}>
                      Confirm decline
                    </button>
                  </form>
                )}
              </>
            )}
            <ReferralActivity
              key={detail.id}
              client={client}
              referralId={detail.id}
              refresh={refresh}
            />
          </section>
        ) : (
          <p role="alert">That referral is not available in this workspace.</p>
        )
      ) : (
        <>
          <div className="workflow-actions" aria-label="Referral status">
            {[
              ["sent", "Awaiting response"],
              ["accepted", "Accepted"],
              ["declined", "Declined"],
            ].map(([value, label]) => (
              <button
                className={`button ${value === tab ? "primary" : "secondary"}`}
                key={value}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {loading ? (
            <p>Loading referrals…</p>
          ) : rows.filter((row) => row.status === tab).length === 0 ? (
            <p>No {tab === "sent" ? "awaiting" : tab} referrals.</p>
          ) : (
            <ul className="workflow-records">
              {rows
                .filter((row) => row.status === tab)
                .map((row) => (
                  <li key={row.id}>
                    <button
                      className="button secondary"
                      onClick={() => {
                        setSelected(row.id);
                        setMessage("");
                      }}
                    >
                      {row.reference} · {row.patient_reference}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </WorkflowShell>
  );
}

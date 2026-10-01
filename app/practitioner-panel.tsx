"use client";
import CapabilityRequirements from "./components/capability-requirements";
import { normalizeTerm } from "./lib/terminology";
import { referralStatusLabel } from "./lib/referral-status";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import WorkflowShell from "./workflow-shell";
import PageState from "./components/page-state";
import PractitionerProfile from "./practitioner-profile";
import ReferralActivity from "./referral-activity";
import HandoverPanel from "./handover-panel";
import { errorText, invoke, requestId } from "./lib/workflow";
import {
  WorkflowError,
  isDefinitiveWorkflowFailure,
} from "./lib/workflow-error";
type Assigned = {
  id: string;
  reference: string;
  patient_reference: string;
  patient_postcode: string;
  clinical_summary: string;
  funding_path: string;
  appointment_format: string;
  language_or_access: string | null;
  preferred_language: string;
  required_service_ids: string[];
  patient_age_group_id: string | null;
  access_notes: string;
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
  const [rows, setRows] = useState<
    Pick<
      Assigned,
      "id" | "reference" | "patient_reference" | "status" | "version"
    >[]
  >([]);
  const [detail, setDetail] = useState<Assigned | null>(null);
  const [cursor, setCursor] = useState<string | null>(null),
    [nextCursor, setNextCursor] = useState<string | null>(null),
    [total, setTotal] = useState(0);
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
  const pending = useRef<Record<string, unknown> | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const responseVersion = useRef<number | null>(null),
    submitting = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!declining && !uncertain) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [declining, uncertain]);
  useEffect(() => {
    let active = true;
    let run = 0;
    async function load() {
      const version = ++run;
      try {
        if (selected) {
          const { data, error } = await client
            .from("referrals")
            .select(
              "id,reference,patient_reference,patient_postcode,clinical_summary,funding_path,appointment_format,language_or_access,preferred_language,access_notes,required_service_ids,patient_age_group_id,status,version",
            )
            .eq("id", selected)
            .eq("selected_practitioner_id", practitioner.practitionerId)
            .maybeSingle();
          if (error) throw error;
          if (active && version === run) setDetail(data as Assigned | null);
        } else {
          const result = await invoke<{
            items: typeof rows;
            total: number;
            nextCursor: string | null;
          }>(client, "manage-referral", {
            operation: "inbox.list",
            practitionerId: practitioner.practitionerId,
            status: tab,
            limit: 25,
            ...(cursor ? { cursor } : {}),
          });
          if (active && version === run) {
            setRows(result.items);
            setTotal(result.total);
            setNextCursor(result.nextCursor);
          }
        }
      } catch (error) {
        if (!active || version !== run) return;
        if (
          error instanceof WorkflowError &&
          ["denied", "unauthorized"].includes(error.code)
        ) {
          setRows([]);
          setDetail(null);
        }
        setMessage(
          "Referrals are unavailable. Saved data may be out of date. Retry when connected; response edits stay on this screen.",
        );
      } finally {
        if (active && version === run) setLoading(false);
      }
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
  }, [client, practitioner.practitionerId, refresh, selected, tab, cursor]);
  async function respond(decision: "accepted" | "declined") {
    if (!detail || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    const payload = pending.current ?? {
      referralId: detail.id,
      expectedVersion: responseVersion.current ?? detail.version,
      decision,
      requestId: requestId(),
      ...(decision === "declined"
        ? { reasonCode: reason, note: note.trim() }
        : {}),
    };
    pending.current = payload;
    try {
      const result = await invoke<{
        referralId: string;
        status: string;
        version: number;
        notification: string;
      }>(client, "respond-to-referral", {
        ...payload,
      });
      if (!mounted.current) return;
      setDetail((current) =>
        current && current.id === result.referralId
          ? { ...current, status: result.status, version: result.version }
          : current,
      );
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
      responseVersion.current = null;
      setUncertain(false);
      setNote("");
      setReason("");
    } catch (error) {
      if (!mounted.current) return;
      if (isDefinitiveWorkflowFailure(error)) {
        pending.current = null;
        setUncertain(false);
      } else setUncertain(true);
      setMessage(errorText(error));
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <WorkflowShell title={`${practitioner.displayName} — referrals`}>
      <PractitionerProfile
        client={client}
        practitionerId={practitioner.practitionerId}
        refreshKey={refresh}
      />
      <label className="workflow-check">
        <input
          type="checkbox"
          checked={available}
          disabled={busy || uncertain || declining}
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
              setRefresh((value) => value + 1);
              setMessage(
                next
                  ? "Intake preference saved. New referrals also require a current credential review."
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
      {uncertain && (
        <div className="workflow-card">
          <p>
            Your response may already be saved. Check the original action before
            making another change.
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void respond(pending.current?.decision as "accepted" | "declined")
            }
          >
            Check and retry response
          </button>
        </div>
      )}
      {selected ? (
        loading && !detail ? (
          <PageState kind="loading" title="Loading referral…" />
        ) : detail ? (
          <section className="workflow-card">
            <button
              className="button secondary"
              disabled={busy || uncertain || declining}
              onClick={() => {
                setSelected(null);
                setDetail(null);
                setLoading(true);
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
            <p>Status: {referralStatusLabel(detail.status)}</p>
            <dl>
              <div>
                <dt>Clinical need</dt>
                <dd>{detail.clinical_summary}</dd>
              </div>
              <CapabilityRequirements
                services={detail.required_service_ids}
                ageGroup={detail.patient_age_group_id}
              />
              <div>
                <dt>Postcode</dt>
                <dd>{detail.patient_postcode}</dd>
              </div>
              <div>
                <dt>Funding and format</dt>
                <dd>
                  {normalizeTerm("funding", detail.funding_path)?.label ??
                    detail.funding_path}{" "}
                  · {detail.appointment_format.replaceAll("_", " ")}
                </dd>
              </div>
              <div>
                <dt>Preferred language</dt>
                <dd>
                  {normalizeTerm("language", detail.preferred_language)
                    ?.label ??
                    (detail.preferred_language || "Not specified")}
                </dd>
              </div>
              <div>
                <dt>Accessibility notes</dt>
                <dd>{detail.access_notes || "Not specified"}</dd>
              </div>
              {detail.language_or_access && (
                <div>
                  <dt>Previously recorded language / access</dt>
                  <dd>{detail.language_or_access}</dd>
                </div>
              )}
            </dl>
            <HandoverPanel
              key={detail.id}
              client={client}
              referralId={detail.id}
              version={detail.version}
            />
            {(detail.status === "sent" || declining) && (
              <>
                <p>
                  Accepting means you agree to handle this referral. It does not
                  book an appointment.
                </p>
                <div className="workflow-actions">
                  <button
                    className="button primary"
                    disabled={busy || uncertain || declining}
                    onClick={() => void respond("accepted")}
                  >
                    Accept referral
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy || uncertain || declining}
                    onClick={() => {
                      responseVersion.current = detail.version;
                      setDeclining(true);
                    }}
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
                        disabled={busy || uncertain}
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
                        disabled={busy || uncertain}
                        maxLength={500}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                      />
                    </label>
                    <p>
                      This note is visible to referral participants. It is not
                      included in email.
                    </p>
                    <button
                      className="button primary"
                      disabled={busy || uncertain}
                    >
                      Confirm decline
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={busy || uncertain}
                      onClick={() => {
                        setDeclining(false);
                        setReason("");
                        setNote("");
                        responseVersion.current = null;
                        setRefresh((v) => v + 1);
                      }}
                    >
                      Discard response edits
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
              ["cancelled", "Cancelled"],
              ["closed", "Closed"],
              ["booked", "Historical booked records"],
            ].map(([value, label]) => (
              <button
                className={`button ${value === tab ? "primary" : "secondary"}`}
                key={value}
                onClick={() => {
                  setTab(value);
                  setCursor(null);
                  setLoading(true);
                }}
                aria-pressed={value === tab}
              >
                {label}
              </button>
            ))}
          </div>
          <p>
            {total} {tab === "sent" ? "awaiting response" : tab} referrals
          </p>
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
                        setDetail(null);
                        setLoading(true);
                        setMessage("");
                      }}
                    >
                      {row.reference} · {row.patient_reference}
                    </button>
                  </li>
                ))}
            </ul>
          )}
          <div className="workflow-actions">
            <button
              className="button secondary"
              disabled={loading || !cursor}
              onClick={() => {
                setCursor(null);
                setLoading(true);
              }}
            >
              Newest inbox page
            </button>
            <button
              className="button secondary"
              disabled={loading || !nextCursor}
              onClick={() => {
                setCursor(nextCursor);
                setLoading(true);
              }}
            >
              Next inbox page
            </button>
          </div>
        </>
      )}
    </WorkflowShell>
  );
}

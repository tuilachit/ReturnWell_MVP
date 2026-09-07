"use client";
/* Full navigation deliberately clears clinical workspace state. */
/* eslint-disable @next/next/no-html-link-for-pages */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  FilePlus2,
  LogOut,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReferralActivity from "./referral-activity";
import { invoke, notificationLabel, type ReferralNotifications } from "./lib/workflow";
import { demoPractitioners, demoReferrals } from "./data/demo-workspace";
import { matchPractitioners } from "./lib/matching";
import { createReferral, listPractitioners, listReferrals, validateReferralInput } from "./lib/referrals";
import type {
  AppointmentFormat,
  Practitioner,
  Profession,
  Referral,
  ReferralInput,
  SelectionMode,
  Workspace,
} from "./types";

type View = "referrals" | "new" | "detail";
type Step = 1 | 2 | 3 | 4;

type PortalProps = {
  mode: "preview" | "authenticated";
  client?: SupabaseClient;
  userId?: string;
  workspace?: Workspace;
  onSignOut?: () => void | Promise<void>;
  onExitPreview?: () => void;
};

const professionLabel = (profession: Profession) => profession === "physiotherapist" ? "Physiotherapy" : "Psychology";
const formatLabel = (format: AppointmentFormat) => ({ either: "Either", in_person: "In person", telehealth: "Telehealth" })[format];
const statusLabel = (status: Referral["status"]) => ({ sent: "Awaiting response", accepted: "Accepted", declined: "Needs another option", booked: "Appointment booked", cancelled: "Cancelled" })[status];

export default function DoctorPortal({
  mode,
  client,
  userId,
  workspace,
  onSignOut,
  onExitPreview,
}: PortalProps) {
  const [refresh, setRefresh] = useState(0);
  const openedRequestedReferral = useRef(false);
  const [view, setView] = useState<View>("referrals");
  const [step, setStep] = useState<Step>(1);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [detailReferral, setDetailReferral] = useState<Referral | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [patientReference, setPatientReference] = useState("");
  const [postcode, setPostcode] = useState("");
  const [profession, setProfession] = useState<Profession>("physiotherapist");
  const [clinicalSummary, setClinicalSummary] = useState("");
  const [fundingPath, setFundingPath] = useState("Medicare");
  const [appointmentFormat, setAppointmentFormat] = useState<AppointmentFormat>("either");
  const [languageOrAccess, setLanguageOrAccess] = useState("");
  const selectionMode: SelectionMode = "doctor";
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<string | null>(null);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [loading, setLoading] = useState(mode === "authenticated");
  const [saving, setSaving] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [error, setError] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const requestedReferralId = mode === "authenticated" && typeof window !== "undefined"
    ? window.location.pathname.match(/^\/referrals\/([0-9a-f-]{36})$/i)?.[1] ?? null
    : null;

  useEffect(() => {
    if (mode !== "authenticated" || !client || !workspace) return;
    let active = true;
    let sequence = 0;
    const load = () => {
    const request = ++sequence;
    Promise.all([
      listReferrals(client, workspace.organisationId),
      listPractitioners(client),
    ]).then(([nextReferrals, nextPractitioners]) => {
      if (!active || request !== sequence) return;
      setDetailReferral(current => current ? nextReferrals.find(row => row.id === current.id) ?? null : null);
      setReferrals(nextReferrals);
      setPractitioners(nextPractitioners);
      if (requestedReferralId && !openedRequestedReferral.current) {
        const requestedReferral = nextReferrals.find((referral) => referral.id === requestedReferralId);
        if (requestedReferral) {
          setDetailReferral(requestedReferral);
          setView("detail");
          openedRequestedReferral.current = true;
        } else {
          setError("That referral is not available in this workspace.");
        }
      }
    }).catch(() => {
      if (active && request === sequence) { setReferrals([]); setPractitioners([]); setDetailReferral(null); setError("We could not load the referral workspace. Please refresh and try again."); }
    }).finally(() => {
      if (active) setLoading(false);
    });
    };
    load();
    const visible = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", visible);
    const timer = window.setInterval(visible, 30000);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", visible); };
  }, [client, mode, requestedReferralId, workspace, refresh]);

  const resetForm = () => {
    setStep(1);
    setPatientReference("");
    setPostcode("");
    setProfession("physiotherapist");
    setClinicalSummary("");
    setFundingPath("Medicare");
    setAppointmentFormat("either");
    setLanguageOrAccess("");
    setSelectedPractitionerId(null);
    setConsentConfirmed(false);
    setDeliveryNote("");
    setError("");
  };

  const goHome = () => {
    setView("referrals");
    setDetailReferral(null);
    setError("");
  };

  const startReferral = () => {
    resetForm();
    setView("new");
  };

  const loadDemoWorkspace = () => {
    setReferrals(demoReferrals);
    setPractitioners(demoPractitioners);
    setDemoMode(true);
    setError("");
  };

  const clearDemoWorkspace = () => {
    setReferrals([]);
    setPractitioners([]);
    setDemoMode(false);
    goHome();
  };

  const matches = useMemo(() => matchPractitioners(practitioners, {
    profession,
    appointmentFormat,
    fundingPath,
    language: languageOrAccess,
  }), [appointmentFormat, fundingPath, languageOrAccess, practitioners, profession]);

  const selectedPractitioner = practitioners.find((item) => item.id === selectedPractitionerId) ?? null;
  const filteredReferrals = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("en-AU");
    return referrals.filter((referral) => {
      const searchable = `${referral.patientReference} ${referral.reference} ${referral.clinicalSummary} ${referral.providerName}`.toLocaleLowerCase("en-AU");
      return (!needle || searchable.includes(needle)) && (statusFilter === "all" || referral.status === statusFilter);
    });
  }, [referrals, search, statusFilter]);

  const formInput = (): ReferralInput => ({
    patientReference,
    patientPostcode: postcode,
    profession,
    clinicalSummary,
    fundingPath,
    appointmentFormat,
    languageOrAccess,
    selectionMode,
    selectedPractitionerId,
    consentConfirmed,
  });

  const proceedToShortlist = (event: React.FormEvent) => {
    event.preventDefault();
    const errors = validateReferralInput({ ...formInput(), selectedPractitionerId: "pending", consentConfirmed: true });
    if (errors.length > 0) {
      setError(errors[0]);
      return;
    }
    setError("");
    setSelectedPractitionerId(null);
    setStep(2);
  };

  const submitReferral = async () => {
    const input = formInput();
    const errors = validateReferralInput(input);
    if (errors.length > 0) {
      setError(errors[0]);
      return;
    }

    setSaving(true);
    setError("");
    try {
      let saved: Referral;
      if (mode === "authenticated" && client && workspace && userId) {
        saved = await createReferral(client, workspace, userId, input);
        saved = { ...saved, providerName: selectedPractitioner?.practiceName ?? saved.providerName };
        try {
          const delivery = await invoke<ReferralNotifications>(client, "send-referral-notification", { referralId: saved.id });
          setDeliveryNote(`The referral was saved. ${delivery.notifications.length ? delivery.notifications.map(notificationLabel).join(". ") : delivery.status === "configuration_needed" ? "Email needs delivery configuration." : "No email notification is recorded yet."}`);
        } catch {
          setDeliveryNote("The referral was saved. Email status could not be checked; refresh the referral detail to check again.");
        }
      } else {
        const now = new Date().toISOString();
        saved = {
          id: crypto.randomUUID(),
          reference: `DEMO-${Date.now().toString().slice(-6)}`,
          patientReference: input.patientReference.trim(),
          patientPostcode: input.patientPostcode,
          profession: input.profession,
          clinicalSummary: input.clinicalSummary.trim(),
          fundingPath: input.fundingPath,
          appointmentFormat: input.appointmentFormat,
          languageOrAccess: input.languageOrAccess.trim(),
          selectionMode: input.selectionMode,
          selectedPractitionerId: input.selectedPractitionerId,
          providerName: selectedPractitioner?.practiceName ?? "Not assigned",
          status: "sent",
          createdAt: now,
          updatedAt: now,
        };
        setDeliveryNote("Preview only. This referral was not saved or transmitted.");
      }
      setReferrals((current) => [saved, ...current]);
      setDetailReferral(saved);
      setStep(4);
    } catch {
      setError("The referral could not be saved. Nothing was sent; please review and try again.");
    } finally {
      setSaving(false);
    }
  };

  const workspaceName = workspace?.organisationName ?? "Empty preview workspace";
  const userName = workspace?.displayName ?? "Local product review";
  const openCount = referrals.filter((item) => !["booked", "cancelled"].includes(item.status)).length;
  const attentionCount = referrals.filter((item) => item.status === "declined").length;
  const bookedCount = referrals.filter((item) => item.status === "booked").length;

  return (
    <main className="gp-shell">
      <aside className="gp-sidebar">
        <button className="sidebar-brand" onClick={goHome} aria-label="Return to referrals"><span aria-hidden="true">R</span><strong>ReturnWell</strong></button>
        <button className="sidebar-primary" onClick={startReferral}><FilePlus2 size={17} />New referral</button>
        <label className="sidebar-search"><Search size={17} /><input aria-label="Search referrals" value={search} onChange={(event) => { setSearch(event.target.value); setView("referrals"); }} placeholder="Search referrals" /></label>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <p>Workspace</p>
          <button className={view !== "new" ? "active" : ""} onClick={goHome}><ClipboardList size={17} />Referrals</button>
          <button className={view === "new" ? "active" : ""} onClick={startReferral}><FilePlus2 size={17} />New referral</button>
        </nav>
        <div className="sidebar-account"><span aria-hidden="true">{userName.slice(0, 1).toUpperCase()}</span><div><strong>{workspaceName}</strong><small>{userName}</small></div><button aria-label={mode === "preview" ? "Exit preview" : "Sign out"} onClick={mode === "preview" ? onExitPreview : onSignOut}><LogOut size={16} /></button></div>
      </aside>

      <section className="gp-workspace">
        <header className="workspace-header"><div><strong>Referral workspace</strong><span>{mode === "preview" ? "Preview — nothing is saved" : "Secure practice workspace"}</span></div><div className="workspace-context">{mode === "authenticated" && <><a href="/">Workspaces</a><a href="/invitations">Invitations</a><button className="button secondary" onClick={() => setRefresh(value => value + 1)}>Refresh</button></>}<span>{workspaceName}</span>{demoMode && <b>Demo data</b>}</div></header>

        {view === "referrals" && (
          <section className="gp-page">
            <div className="page-heading"><div><p className="eyebrow">Clinical referrals</p><h1>Referrals</h1><p>Create a referral, choose an appropriate practitioner, and follow the outcome.</p></div><button className="button primary" onClick={startReferral}>New referral <ArrowRight size={16} /></button></div>
            {mode === "preview" && <div className="preview-banner"><span><strong>Preview workspace.</strong> Nothing here is saved or transmitted.</span>{demoMode && <button onClick={clearDemoWorkspace}>Clear demo data</button>}</div>}
            {error && <div className="error-banner" role="alert"><CircleAlert size={17} />{error}</div>}
            <section className="summary-strip" aria-label="Referral summary"><div><span>Open</span><strong>{openCount}</strong></div><div><span>Needs attention</span><strong>{attentionCount}</strong></div><div><span>Booked</span><strong>{bookedCount}</strong></div></section>

            {loading ? <div className="loading-state">Opening your referrals…</div> : referrals.length === 0 ? (
              <section className="empty-state"><div className="empty-icon"><ClipboardList size={25} /></div><p className="eyebrow">Ready to begin</p><h2>No referrals yet</h2><p>Create your first referral to find verified allied health practitioners and keep the response in one place.</p><div className="empty-actions"><button className="button primary" onClick={startReferral}>Create your first referral</button>{mode === "preview" && <button className="button secondary" onClick={loadDemoWorkspace}>Load demo workspace</button>}</div>{mode === "preview" && <small>Demo records are fictional and remain in this browser tab only.</small>}</section>
            ) : (
              <section className="activity-section"><div className="section-heading"><div><h2>Referral activity</h2><span>{filteredReferrals.length} shown</span></div><select aria-label="Filter referral status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="sent">Awaiting response</option><option value="accepted">Accepted</option><option value="declined">Needs another option</option><option value="booked">Appointment booked</option></select></div><div className="referral-table" aria-label="Referrals"><div className="referral-table-head"><span>Reference</span><span>Need</span><span>Practitioner</span><span>Status</span><span>Updated</span><span /></div>{filteredReferrals.map((referral) => <button className="referral-row" key={referral.id} onClick={() => { setDetailReferral(referral); setView("detail"); }}><span><strong>{referral.patientReference}</strong><small>{referral.reference}</small></span><span><strong>{professionLabel(referral.profession)}</strong><small>{referral.clinicalSummary}</small></span><span><strong>{referral.providerName}</strong><small>{formatLabel(referral.appointmentFormat)}</small></span><span><i className={`status-dot ${referral.status}`} />{statusLabel(referral.status)}</span><span>{new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short" }).format(new Date(referral.updatedAt))}</span><ChevronRight size={16} /></button>)}{filteredReferrals.length === 0 && <p className="empty-filter">No referrals match that search or filter.</p>}</div></section>
            )}
          </section>
        )}

        {view === "new" && (
          <section className="gp-page referral-flow">
            <button className="back-link" onClick={step === 1 || step === 4 ? goHome : () => { setError(""); setConsentConfirmed(false); setStep((step - 1) as Step); }}><ArrowLeft size={15} />{step === 1 || step === 4 ? "Referrals" : "Back"}</button>
            <div className="flow-heading"><div><p className="eyebrow">New referral</p><h1>{step === 1 ? "Referral need" : step === 2 ? "Practitioner shortlist" : step === 3 ? "Review referral" : "Referral recorded"}</h1></div><ol aria-label="Referral progress">{[1, 2, 3, 4].map((number) => <li className={step === number ? "current" : step > number ? "complete" : ""} key={number}>{step > number ? <Check size={12} /> : number}</li>)}</ol></div>
            {mode === "preview" && <div className="preview-banner"><span><strong>Preview only.</strong> Use fictional information. Nothing is saved or transmitted.</span></div>}
            {error && <div className="error-banner" role="alert"><CircleAlert size={17} />{error}</div>}

            {step === 1 && <form className="referral-form" onSubmit={proceedToShortlist}><fieldset><legend>Patient reference</legend><p>Use the identifier from your practice system. Avoid a full name where possible.</p><div className="form-grid"><label><span>Patient reference</span><input required value={patientReference} onChange={(event) => setPatientReference(event.target.value)} placeholder="Practice record ID" /></label><label><span>Postcode</span><input required inputMode="numeric" maxLength={4} value={postcode} onChange={(event) => setPostcode(event.target.value.replace(/\D/g, ""))} placeholder="2000" /></label></div></fieldset><fieldset><legend>Clinical need</legend><div className="form-grid"><label><span>Profession</span><select value={profession} onChange={(event) => setProfession(event.target.value as Profession)}><option value="physiotherapist">Physiotherapist</option><option value="psychologist">Psychologist</option></select></label><label><span>Appointment format</span><select value={appointmentFormat} onChange={(event) => setAppointmentFormat(event.target.value as AppointmentFormat)}><option value="either">Either</option><option value="in_person">In person</option><option value="telehealth">Telehealth</option></select></label><label className="full"><span>Reason for referral</span><textarea required rows={5} value={clinicalSummary} onChange={(event) => setClinicalSummary(event.target.value)} placeholder="Relevant need, goals and important context" /></label></div></fieldset><fieldset><legend>Access</legend><div className="form-grid"><label><span>Funding pathway</span><select value={fundingPath} onChange={(event) => setFundingPath(event.target.value)}><option>Medicare</option><option>Self funded</option><option>NDIS</option></select></label><label><span>Preferred language</span><input value={languageOrAccess} onChange={(event) => setLanguageOrAccess(event.target.value)} placeholder="Optional" /></label></div></fieldset><div className="form-actions"><button type="button" className="button secondary" onClick={goHome}>Cancel</button><button className="button primary">Find practitioners <ArrowRight size={16} /></button></div></form>}

            {step === 2 && <div className="shortlist-layout"><aside className="need-summary"><h2>Referral need</h2><dl><div><dt>Profession</dt><dd>{professionLabel(profession)}</dd></div><div><dt>Location</dt><dd>{postcode}</dd></div><div><dt>Format</dt><dd>{formatLabel(appointmentFormat)}</dd></div><div><dt>Funding</dt><dd>{fundingPath}</dd></div>{languageOrAccess && <div><dt>Language</dt><dd>{languageOrAccess}</dd></div>}</dl><button className="text-button" onClick={() => setStep(1)}>Edit referral need</button></aside><section className="shortlist-main"><div className="section-heading"><div><h2>{matches.length} eligible {matches.length === 1 ? "practitioner" : "practitioners"}</h2><p>Ordered by known distance, then name. Every reason is shown; no AI score is used.</p></div></div>{matches.length === 0 ? <div className="no-matches"><h3>No eligible practitioners found</h3><p>Only active, registration-verified and provider-confirmed profiles accepting referrals can appear. Try changing the format, funding or language preference.</p>{mode === "preview" && !demoMode && <button className="button secondary" onClick={loadDemoWorkspace}>Load demo workspace</button>}</div> : <div className="provider-list">{matches.map(({ practitioner, reasons }) => <label className={`provider-row ${selectedPractitionerId === practitioner.id ? "selected" : ""}`} key={practitioner.id}><input type="radio" name="practitioner" checked={selectedPractitionerId === practitioner.id} onChange={() => setSelectedPractitionerId(practitioner.id)} /><span className="provider-name"><strong>{practitioner.displayName}</strong><small>{practitioner.practiceName}</small></span><span><strong>{practitioner.location ? `${practitioner.location.suburb} ${practitioner.location.postcode}` : "Telehealth"}</strong><small>{practitioner.services.slice(0, 2).join(" · ")}</small></span><ul>{reasons.slice(0, 4).map((reason) => <li key={reason}><Check size={12} />{reason}</li>)}</ul></label>)}</div>}<div className="form-actions"><button className="button secondary" onClick={() => setStep(1)}>Back</button><button className="button primary" disabled={!selectedPractitionerId} onClick={() => setStep(3)}>Review referral <ArrowRight size={16} /></button></div></section></div>}

            {step === 3 && <div className="review-layout"><section className="review-card"><h2>Referral details</h2><dl><div><dt>Patient reference</dt><dd>{patientReference}</dd></div><div><dt>Reason</dt><dd>{clinicalSummary}</dd></div><div><dt>Profession</dt><dd>{professionLabel(profession)}</dd></div><div><dt>Practitioner</dt><dd>{selectedPractitioner?.displayName}<small>{selectedPractitioner?.practiceName}</small></dd></div><div><dt>Access</dt><dd>{fundingPath} · {formatLabel(appointmentFormat)}{languageOrAccess ? ` · ${languageOrAccess}` : ""}</dd></div></dl><button className="text-button" onClick={() => setStep(1)}>Edit referral</button></section><aside className="send-card"><h2>Record referral</h2><p>{mode === "preview" ? "This preview will show the next step without saving or sending anything." : "The referral will be saved securely. Email delivery remains off until the sender configuration is approved."}</p><label className="consent-check"><input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} /><span>I confirm the patient has consented and the information is accurate.</span></label><button className="button primary full" disabled={!consentConfirmed || saving} onClick={submitReferral}>{saving ? "Saving…" : "Record referral"}</button></aside></div>}

            {step === 4 && <section className="success-state"><div><Check size={24} /></div><p className="eyebrow">Complete</p><h2>Referral recorded</h2><p>{deliveryNote}</p><dl><div><dt>Reference</dt><dd>{detailReferral?.reference}</dd></div><div><dt>Practitioner</dt><dd>{detailReferral?.providerName}</dd></div></dl><div className="empty-actions"><button className="button secondary" onClick={goHome}>Back to referrals</button><button className="button primary" onClick={() => setView("detail")}>View referral</button></div></section>}
          </section>
        )}

        {view === "detail" && detailReferral && <section className="gp-page detail-page"><button className="back-link" onClick={goHome}><ArrowLeft size={15} />Referrals</button><div className="page-heading"><div><p className="eyebrow">{detailReferral.reference}</p><h1>{detailReferral.patientReference}</h1><p>{professionLabel(detailReferral.profession)} referral</p></div><span className="status-pill"><i className={`status-dot ${detailReferral.status}`} />{statusLabel(detailReferral.status)}</span></div><div className="detail-layout"><section className="review-card"><h2>Referral</h2><dl><div><dt>Clinical need</dt><dd>{detailReferral.clinicalSummary}</dd></div><div><dt>Patient postcode</dt><dd>{detailReferral.patientPostcode}</dd></div><div><dt>Practitioner</dt><dd>{detailReferral.providerName}</dd></div><div><dt>Funding and format</dt><dd>{detailReferral.fundingPath} · {formatLabel(detailReferral.appointmentFormat)}</dd></div></dl></section>{client && mode === "authenticated" ? <ReferralActivity key={detailReferral.id} client={client} referralId={detailReferral.id} refresh={refresh} /> : <aside className="timeline"><h2>Preview activity</h2><ol><li className="done"><i /><div><strong>Referral recorded</strong><span>{new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(new Date(detailReferral.createdAt))}</span></div></li><li className="current"><i /><div><strong>Current status</strong><span>{statusLabel(detailReferral.status)}</span></div></li><li><i /><div><strong>Appointment</strong><span>Not yet recorded</span></div></li></ol></aside>}</div></section>}
      </section>
    </main>
  );
}

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
  ChevronDown,
  FlaskConical,
  LockKeyhole,
  LogOut,
  Menu,
  RefreshCw,
  X,
  ReferralIcon as ClipboardList,
  ComposeIcon as FilePlus2,
  PracticeIcon as Building2,
  GuideIcon as BookOpen,
  PeopleIcon as Users,
} from "./ui-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import ReferralActivity from "./referral-activity";
import ReferralOverview from "./referral-overview";
import PractitionerDirectory from "./practitioner-directory";
import ReferralGuide from "./referral-guide";
import { Brand } from "./brand";
import {
  invoke,
  WorkflowError,
  notificationLabel,
  type ReferralNotifications,
} from "./lib/workflow";
import { demoPractitioners, demoReferrals } from "./data/demo-workspace";
import { matchPractitioners } from "./lib/matching";
import { professionLabel, supportedProfessions } from "./lib/professions";
import { referralStatusLabel as statusLabel } from "./lib/referral-status";
import ReferralDraftPanel from "./referral-draft-panel";
import ConfirmDialog from "./components/confirm-dialog";
import {
  saveReferralDraft,
  finalizeReferralDraft,
  type DraftInput,
  type ReferralDraft,
} from "./lib/referral-drafts";
import {
  rowToReferral,
  type ReferralRow,
  ReferralSubmissionError,
  listPractitioners,
  listReferrals,
  validateReferralInput,
} from "./lib/referrals";
import type {
  AppointmentFormat,
  Practitioner,
  Profession,
  Referral,
  ReferralInput,
  SelectionMode,
  Workspace,
} from "./types";

type View = "referrals" | "new" | "detail" | "directory" | "guide";
type Step = 1 | 2 | 3 | 4;

type PortalProps = {
  mode: "preview" | "authenticated";
  client?: SupabaseClient;
  userId?: string;
  workspace?: Workspace;
  onSignOut?: () => void | Promise<void>;
  onExitPreview?: () => void;
};

const formatLabel = (format: AppointmentFormat) =>
  ({ either: "Either", in_person: "In person", telehealth: "Telehealth" })[
    format
  ];

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
  const [mobileNav, setMobileNav] = useState(false);
  const pageHeading = useRef<HTMLElement>(null);
  const sidebar = useRef<HTMLElement>(null);
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
  const [appointmentFormat, setAppointmentFormat] =
    useState<AppointmentFormat>("either");
  const [languageOrAccess, setLanguageOrAccess] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const selectionMode: SelectionMode = "doctor";
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<
    string | null
  >(null);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [draft, setDraft] = useState<ReferralDraft | null>(null);
  const [draftPending, setDraftPending] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const leaveAction = useRef<(() => void) | null>(null);
  const [loading, setLoading] = useState(mode === "authenticated");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const pendingSubmission = useRef<{
    id: string;
    input: ReferralInput;
    organisationId: string;
    userId: string;
    draftVersion: number;
    saveRequestId: string;
    sendRequestId: string;
  } | null>(null);
  const [submissionPending, setSubmissionPending] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const requestedReferralId =
    mode === "authenticated" && typeof window !== "undefined"
      ? (window.location.pathname.match(
          /^\/referrals\/([0-9a-f-]{36})$/i,
        )?.[1] ?? null)
      : null;

  const dirtyDraft =
    view === "new" &&
    step < 4 &&
    Boolean(
      patientReference ||
      clinicalSummary ||
      postcode ||
      languageOrAccess ||
      accessNotes,
    ) &&
    (!draft ||
      patientReference !== (draft.input.patientReference ?? "") ||
      clinicalSummary !== (draft.input.clinicalSummary ?? "") ||
      postcode !== (draft.input.patientPostcode ?? "") ||
      profession !== draft.input.profession ||
      fundingPath !== draft.input.fundingPath ||
      appointmentFormat !== draft.input.appointmentFormat ||
      accessNotes !== (draft.input.accessNotes ?? "") ||
      languageOrAccess !==
        (draft.input.preferredLanguage ?? draft.input.languageOrAccess ?? ""));
  useEffect(() => {
    if (!submissionPending && !draftPending && !dirtyDraft) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [submissionPending, draftPending, dirtyDraft]);

  useEffect(() => {
    const heading = pageHeading.current?.querySelector<HTMLElement>("h1");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view, step]);

  useEffect(() => {
    if (!mobileNav) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controls = () =>
      Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>("button, a[href]") ?? [],
      ).filter((element) => element.getClientRects().length > 0);
    const focusFrame = requestAnimationFrame(() => controls()[0]?.focus());
    const desktop = window.matchMedia("(min-width: 901px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileNav(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNav(false);
      if (event.key !== "Tab") return;
      const focusable = controls();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!sidebar.current?.contains(document.activeElement)) {
        event.preventDefault();
        first?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      cancelAnimationFrame(focusFrame);
      desktop.removeEventListener("change", closeOnDesktop);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [mobileNav]);

  useEffect(() => {
    if (mode !== "authenticated" || !client || !workspace) return;
    let active = true;
    let sequence = 0;
    const load = () => {
      const request = ++sequence;
      Promise.all([
        listReferrals(client, workspace.organisationId),
        listPractitioners(client),
      ])
        .then(([nextReferrals, nextPractitioners]) => {
          if (!active || request !== sequence) return;
          setLoadError("");
          setDetailReferral((current) =>
            current
              ? (nextReferrals.find((row) => row.id === current.id) ?? null)
              : null,
          );
          setReferrals(nextReferrals);
          setPractitioners(nextPractitioners);
          if (requestedReferralId && !openedRequestedReferral.current) {
            const requestedReferral = nextReferrals.find(
              (referral) => referral.id === requestedReferralId,
            );
            if (requestedReferral) {
              setDetailReferral(requestedReferral);
              setView("detail");
              openedRequestedReferral.current = true;
            } else {
              setError("That referral is not available in this workspace.");
            }
          }
        })
        .catch(() => {
          if (active && request === sequence) {
            setReferrals([]);
            setPractitioners([]);
            setDetailReferral(null);
            setLoadError(
              "We could not load the referral workspace. Please refresh and try again.",
            );
          }
        })
        .finally(() => {
          if (active && request === sequence) setLoading(false);
        });
    };
    load();
    const visible = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", visible);
    const timer = window.setInterval(visible, 30000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", visible);
    };
  }, [client, mode, requestedReferralId, workspace, refresh]);

  const resetForm = () => {
    setDraft(null);
    setDraftPending(false);
    setStep(1);
    setPatientReference("");
    setPostcode("");
    setProfession("physiotherapist");
    setClinicalSummary("");
    setFundingPath("Medicare");
    setAppointmentFormat("either");
    setLanguageOrAccess("");
    setAccessNotes("");
    setSelectedPractitionerId(null);
    setConsentConfirmed(false);
    setDeliveryNote("");
    setError("");
  };

  const requestLeave = (action: () => void) => {
    if (submissionPending || draftPending) {
      setError("Resolve the pending save before leaving this referral.");
      return;
    }
    if (dirtyDraft) {
      leaveAction.current = action;
      setLeaving(true);
      return;
    }
    action();
  };
  const goHome = () =>
    requestLeave(() => {
      setMobileNav(false);
      setView("referrals");
      setDetailReferral(null);
      setError("");
    });

  const startReferral = () => {
    setMobileNav(false);
    if (pendingSubmission.current || submitting.current) {
      setStep(3);
      setView("new");
      return;
    }
    requestLeave(() => {
      resetForm();
      setView("new");
    });
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
    setSearch("");
    setStatusFilter("all");
    resetForm();
    goHome();
  };

  const matches = useMemo(
    () =>
      matchPractitioners(practitioners, {
        profession,
        appointmentFormat,
        fundingPath,
        language: languageOrAccess,
      }),
    [
      appointmentFormat,
      fundingPath,
      languageOrAccess,
      practitioners,
      profession,
    ],
  );

  const selectedPractitioner =
    practitioners.find((item) => item.id === selectedPractitionerId) ?? null;
  const filteredReferrals = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("en-AU");
    return referrals.filter((referral) => {
      const searchable =
        `${referral.patientReference} ${referral.reference} ${referral.clinicalSummary} ${referral.providerName}`.toLocaleLowerCase(
          "en-AU",
        );
      return (
        (!needle || searchable.includes(needle)) &&
        (statusFilter === "all" || referral.status === statusFilter)
      );
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
    preferredLanguage: languageOrAccess,
    accessNotes,
    selectionMode,
    selectedPractitionerId,
    consentConfirmed,
  });

  const draftInput = (): DraftInput => ({
    patientReference,
    patientPostcode: postcode,
    profession,
    clinicalSummary,
    fundingPath,
    appointmentFormat,
    languageOrAccess: "",
    selectedPractitionerId,
    preferredLanguage: languageOrAccess,
    accessNotes,
  });
  const restoreDraft = (saved: ReferralDraft) => {
    setDraft(saved);
    setPatientReference(saved.input.patientReference ?? "");
    setPostcode(saved.input.patientPostcode ?? "");
    setProfession(saved.input.profession ?? "physiotherapist");
    setClinicalSummary(saved.input.clinicalSummary ?? "");
    setFundingPath(saved.input.fundingPath ?? "Medicare");
    setAppointmentFormat(saved.input.appointmentFormat ?? "either");
    setLanguageOrAccess(
      saved.input.preferredLanguage ?? saved.input.languageOrAccess ?? "",
    );
    setAccessNotes(saved.input.accessNotes ?? "");
    setSelectedPractitionerId(saved.input.selectedPractitionerId ?? null);
    setConsentConfirmed(false);
    setStep(1);
    setError("");
  };
  const proceedToShortlist = (event: React.FormEvent) => {
    event.preventDefault();
    if (draftPending || saving || submissionPending) return;
    const errors = validateReferralInput({
      ...formInput(),
      selectedPractitionerId: "pending",
      consentConfirmed: true,
    });
    if (errors.length > 0) {
      setError(errors[0]);
      return;
    }
    setError("");
    setSelectedPractitionerId((current) =>
      matches.some(({ practitioner }) => practitioner.id === current)
        ? current
        : null,
    );
    setStep(2);
  };

  const submitReferral = async () => {
    // State updates alone do not stop two clicks in the same render frame.
    if (submitting.current) return;
    const wasPending = pendingSubmission.current !== null;
    const input = pendingSubmission.current?.input ?? formInput();
    const errors = validateReferralInput(input);
    if (errors.length > 0) {
      setError(errors[0]);
      return;
    }

    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      let saved: Referral;
      if (mode === "authenticated" && client && workspace && userId) {
        const submission = pendingSubmission.current ?? {
          id: draft?.id ?? crypto.randomUUID(),
          input: { ...input },
          organisationId: workspace.organisationId,
          userId,
          draftVersion: draft?.version ?? -1,
          saveRequestId: crypto.randomUUID(),
          sendRequestId: crypto.randomUUID(),
        };
        pendingSubmission.current = submission;
        setSubmissionPending(true);
        if (
          submission.organisationId !== workspace.organisationId ||
          submission.userId !== userId
        ) {
          throw new ReferralSubmissionError("unconfirmed");
        }
        const workingCopy: DraftInput = {
          patientReference: submission.input.patientReference,
          patientPostcode: submission.input.patientPostcode,
          profession: submission.input.profession,
          clinicalSummary: submission.input.clinicalSummary,
          fundingPath: submission.input.fundingPath,
          appointmentFormat: submission.input.appointmentFormat,
          languageOrAccess: "",
          preferredLanguage:
            submission.input.preferredLanguage ??
            submission.input.languageOrAccess,
          accessNotes: submission.input.accessNotes ?? "",
          selectedPractitionerId: submission.input.selectedPractitionerId,
        };
        const savedDraft = await saveReferralDraft(client, {
          id: submission.id,
          organisationId: workspace.organisationId,
          expectedVersion: submission.draftVersion,
          requestId: submission.saveRequestId,
          input: workingCopy,
        });
        setDraft(savedDraft);
        const result = await finalizeReferralDraft(client, {
          id: savedDraft.id,
          expectedVersion: savedDraft.version,
          consentConfirmed: true,
          requestId: submission.sendRequestId,
        });
        saved = rowToReferral(result as ReferralRow);
        saved = {
          ...saved,
          providerName:
            selectedPractitioner?.practiceName ?? saved.providerName,
        };
        try {
          const delivery = await invoke<ReferralNotifications>(
            client,
            "send-referral-notification",
            { referralId: saved.id },
          );
          setDeliveryNote(
            `The referral was saved. ${delivery.notifications.length ? delivery.notifications.map(notificationLabel).join(". ") : delivery.status === "configuration_needed" ? "Email needs delivery configuration." : "No email notification is recorded yet."}`,
          );
        } catch {
          setDeliveryNote(
            "The referral was saved. Email status could not be checked; refresh the referral detail to check again.",
          );
        }
      } else if (mode === "preview") {
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
        setDeliveryNote(
          "Preview only. This referral was not saved or transmitted.",
        );
      } else {
        throw new ReferralSubmissionError("rejected");
      }
      pendingSubmission.current = null;
      setSubmissionPending(false);
      setReferrals((current) => [
        saved,
        ...current.filter((row) => row.id !== saved.id),
      ]);
      setDetailReferral(saved);
      setStep(4);
    } catch (failure) {
      // A definite rejection on a first attempt allows correction. A later
      // rejection cannot disprove an earlier ambiguous commit, so retain it.
      if (
        !wasPending &&
        ((failure instanceof ReferralSubmissionError &&
          failure.outcome === "rejected") ||
          (failure instanceof WorkflowError && failure.status < 500))
      ) {
        pendingSubmission.current = null;
        setSubmissionPending(false);
      }
      setError(
        wasPending &&
          failure instanceof ReferralSubmissionError &&
          failure.outcome === "rejected"
          ? new ReferralSubmissionError("unconfirmed").message
          : failure instanceof ReferralSubmissionError ||
              (!wasPending && failure instanceof WorkflowError)
            ? failure.message
            : "We could not confirm whether the referral was saved. Keep this page open and use Check and retry before starting another referral.",
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  const workspaceName = workspace?.organisationName ?? "Your practice";
  const userName = workspace?.displayName ?? "Preview workspace";
  const refreshWorkspace = () => {
    setLoading(true);
    setRefresh((value) => value + 1);
  };
  const navigate = (next: View) => {
    requestLeave(() => {
      setView(next);
      setMobileNav(false);
      setError("");
    });
  };

  return (
    <main className={`gp-shell ${mobileNav ? "nav-open" : ""}`}>
      <ConfirmDialog
        open={leaving}
        title="Leave this draft?"
        description="Unsaved changes will be discarded. A draft you have already saved stays in your private draft list."
        confirmLabel="Discard unsaved changes"
        onConfirm={() => {
          resetForm();
          setLeaving(false);
          leaveAction.current?.();
          leaveAction.current = null;
        }}
        onCancel={() => {
          setLeaving(false);
          leaveAction.current = null;
        }}
      />
      <a className="skip-link" href="#workspace-content">
        Skip to content
      </a>
      {mobileNav && (
        <button
          className="mobile-nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        className="gp-sidebar"
        id="workspace-navigation"
        ref={sidebar}
        role={mobileNav ? "dialog" : undefined}
        aria-modal={mobileNav || undefined}
        aria-label={mobileNav ? "Workspace navigation" : undefined}
      >
        <div className="sidebar-brand-row">
          <button
            className="sidebar-brand"
            onClick={goHome}
            aria-label="Return to referrals"
          >
            <Brand />
          </button>
          <button
            className="mobile-nav-close icon-button"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          >
            <X size={19} />
          </button>
        </div>
        <div className="practice-switcher">
          <span className="practice-icon">
            <Building2 size={19} />
          </span>
          <div>
            <strong>{workspaceName}</strong>
            <small>
              {mode === "preview" ? "Explore ReturnWell" : "GP workspace"}
            </small>
          </div>
          {mode === "authenticated" && (
            <a href="/" aria-label="Switch workspace">
              <ChevronDown size={16} />
            </a>
          )}
        </div>
        <button className="sidebar-primary" onClick={startReferral}>
          <FilePlus2 size={17} />
          New referral<span>+</span>
        </button>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <p>Workspace</p>
          <button
            className={["referrals", "detail"].includes(view) ? "active" : ""}
            aria-current={
              ["referrals", "detail"].includes(view) ? "page" : undefined
            }
            onClick={goHome}
          >
            <span className="nav-symbol">
              <ClipboardList size={22} />
            </span>
            Referrals<span className="nav-count">{referrals.length}</span>
          </button>
          <button
            className={view === "directory" ? "active" : ""}
            aria-current={view === "directory" ? "page" : undefined}
            onClick={() => navigate("directory")}
          >
            <span className="nav-symbol">
              <Users size={22} />
            </span>
            Practitioners
          </button>
          {mode === "authenticated" && (
            <a href="/invitations">
              <span className="nav-symbol">
                <FilePlus2 size={22} />
              </span>
              Invitations
            </a>
          )}
        </nav>
        <div className="sidebar-bottom">
          <p className="sidebar-guide-label">A clearer referral pathway</p>
          <nav className="sidebar-nav" aria-label="Workspace help">
            <button
              className={view === "guide" ? "active" : ""}
              aria-current={view === "guide" ? "page" : undefined}
              onClick={() => navigate("guide")}
            >
              <span className="nav-symbol">
                <BookOpen size={22} />
              </span>
              Referral guide
            </button>
          </nav>
        </div>
        <div className="sidebar-account">
          <span aria-hidden="true">
            {mode === "preview"
              ? "GP"
              : userName
                  .split(" ")
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")}
          </span>
          <div>
            <strong>
              {mode === "preview" ? "Practice preview" : userName}
            </strong>
            <small>
              {mode === "preview" ? "Nothing is saved" : workspaceName}
            </small>
          </div>
          <button
            aria-label={mode === "preview" ? "Exit preview" : "Sign out"}
            title={mode === "preview" ? "Exit preview" : "Sign out"}
            onClick={mode === "preview" ? onExitPreview : onSignOut}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <section
        className="gp-workspace"
        ref={pageHeading}
        inert={mobileNav || undefined}
      >
        <header className="workspace-header">
          <div className="workspace-breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              aria-expanded={mobileNav}
              aria-controls="workspace-navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {view === "new"
                ? "New referral"
                : view === "detail"
                  ? "Referral details"
                  : view === "directory"
                    ? "Practitioners"
                    : view === "guide"
                      ? "Referral guide"
                      : "Referrals"}
            </strong>
          </div>
          <div className="workspace-context">
            {mode === "authenticated" ? (
              <>
                <span>
                  <LockKeyhole size={13} />
                  Practice workspace
                </span>
                <button
                  className="icon-button"
                  aria-label="Refresh workspace"
                  onClick={refreshWorkspace}
                >
                  <RefreshCw size={16} />
                </button>
              </>
            ) : (
              <span className="preview-tag">
                <FlaskConical size={13} />
                {demoMode ? "Fictional demo" : "Preview mode"}
              </span>
            )}
            <span className="header-avatar">
              {mode === "preview" ? "GP" : userName.slice(0, 1)}
            </span>
          </div>
        </header>
        <div id="workspace-content" tabIndex={-1}>
          {mode === "preview" && (
            <div className="preview-banner">
              <span>
                <FlaskConical size={14} />
                <strong>
                  {demoMode
                    ? "Fictional demo workspace"
                    : "You’re exploring a preview"}
                </strong>
                <span>Nothing is saved or transmitted.</span>
              </span>
              {demoMode && (
                <button onClick={clearDemoWorkspace}>
                  Clear demo data <X size={13} />
                </button>
              )}
            </div>
          )}

          {view === "referrals" && (
            <section className="gp-page">
              {(error || loadError) && (
                <div className="error-banner" role="alert">
                  <CircleAlert size={17} />
                  {error || loadError}
                </div>
              )}
              <ReferralOverview
                referrals={referrals}
                filtered={filteredReferrals}
                loading={loading}
                preview={mode === "preview"}
                demo={demoMode}
                search={search}
                setSearch={setSearch}
                status={statusFilter}
                setStatus={setStatusFilter}
                onNew={startReferral}
                onOpen={(referral) => {
                  setDetailReferral(referral);
                  setView("detail");
                }}
                onDemo={loadDemoWorkspace}
                onGuide={() => navigate("guide")}
              />
            </section>
          )}

          {view === "directory" && (
            <section className="gp-page">
              <PractitionerDirectory
                practitioners={practitioners}
                loading={loading}
                error={loadError}
                onRetry={refreshWorkspace}
                preview={mode === "preview"}
                demo={demoMode}
                onDemo={loadDemoWorkspace}
                onRefer={(practitioner) => {
                  if (pendingSubmission.current || submitting.current) {
                    startReferral();
                    return;
                  }
                  startReferral();
                  setProfession(practitioner.profession);
                  setSelectedPractitionerId(practitioner.id);
                }}
              />
            </section>
          )}
          {view === "guide" && (
            <section className="gp-page">
              <ReferralGuide onNew={startReferral} />
            </section>
          )}

          {view === "new" && (
            <section className="gp-page referral-flow">
              <button
                className="back-link"
                disabled={saving || submissionPending}
                onClick={
                  step === 1 || step === 4
                    ? goHome
                    : () => {
                        setError("");
                        setConsentConfirmed(false);
                        setStep((step - 1) as Step);
                      }
                }
              >
                <ArrowLeft size={15} />
                {step === 1 || step === 4 ? "Referrals" : "Back"}
              </button>
              <div className="flow-heading">
                <div>
                  <h1 tabIndex={-1}>
                    {step === 1
                      ? "New referral"
                      : step === 2
                        ? "Choose a practitioner"
                        : step === 3
                          ? "Review referral"
                          : "Referral recorded"}
                  </h1>
                  <p>
                    {step === 1
                      ? "Add the patient’s needs and appointment preferences."
                      : step === 2
                        ? "Review the matches and choose who to refer to."
                        : step === 3
                          ? "Check the details, then confirm the handover."
                          : "Follow the referral and its response from your workspace."}
                  </p>
                </div>
              </div>
              <ol className="flow-progress" aria-label="Referral progress">
                {[
                  "Referral need",
                  "Practitioner",
                  "Review & consent",
                  "Complete",
                ].map((label, index) => (
                  <li
                    aria-current={step === index + 1 ? "step" : undefined}
                    className={
                      step === index + 1
                        ? "current"
                        : step > index + 1
                          ? "complete"
                          : ""
                    }
                    key={label}
                  >
                    <span>
                      {step > index + 1 ? <Check size={13} /> : `0${index + 1}`}
                    </span>
                    <strong>{label}</strong>
                  </li>
                ))}
              </ol>
              {(error || loadError) && (
                <div className="error-banner" role="alert">
                  <CircleAlert size={17} />
                  {error || loadError}
                </div>
              )}

              {step === 1 && (
                <div className="referral-start-layout">
                  <form className="referral-form" onSubmit={proceedToShortlist}>
                    {mode === "authenticated" && client && workspace && (
                      <ReferralDraftPanel
                        client={client}
                        organisationId={workspace.organisationId}
                        input={draftInput()}
                        draft={draft}
                        disabled={saving || submissionPending}
                        onSaved={setDraft}
                        onLoad={restoreDraft}
                        onPendingChange={setDraftPending}
                      />
                    )}
                    <fieldset>
                      <legend>Patient details</legend>
                      <p>
                        Use a reference from your practice system, rather than a
                        full name.
                      </p>
                      <div className="form-grid">
                        <label>
                          <span>
                            Patient reference <b>*</b>
                          </span>
                          <input
                            required
                            value={patientReference}
                            onChange={(event) =>
                              setPatientReference(event.target.value)
                            }
                            placeholder="e.g. Practice record ID"
                          />
                        </label>
                        <label>
                          <span>
                            Patient postcode <b>*</b>
                          </span>
                          <input
                            required
                            inputMode="numeric"
                            pattern="[0-9]{4}"
                            maxLength={4}
                            value={postcode}
                            onChange={(event) =>
                              setPostcode(event.target.value.replace(/\D/g, ""))
                            }
                            placeholder="e.g. 2000"
                          />
                        </label>
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend>Clinical need</legend>
                      <p>
                        The relevant context for the practitioner receiving your
                        referral.
                      </p>
                      <div className="form-grid">
                        <label>
                          <span>Profession</span>
                          <select
                            value={profession}
                            onChange={(event) =>
                              setProfession(event.target.value as Profession)
                            }
                          >
                            {supportedProfessions.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Appointment format</span>
                          <select
                            value={appointmentFormat}
                            onChange={(event) =>
                              setAppointmentFormat(
                                event.target.value as AppointmentFormat,
                              )
                            }
                          >
                            <option value="either">
                              In person or telehealth
                            </option>
                            <option value="in_person">In person</option>
                            <option value="telehealth">Telehealth</option>
                          </select>
                        </label>
                        <label className="full">
                          <span>
                            Reason for referral <b>*</b>
                          </span>
                          <textarea
                            required
                            rows={4}
                            value={clinicalSummary}
                            onChange={(event) =>
                              setClinicalSummary(event.target.value)
                            }
                            placeholder="Describe the need, goals and relevant context…"
                          />
                        </label>
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend>Access & preferences</legend>
                      <p>Help us narrow the shortlist to suitable options.</p>
                      <div className="form-grid">
                        <label>
                          <span>Funding pathway</span>
                          <select
                            value={fundingPath}
                            onChange={(event) =>
                              setFundingPath(event.target.value)
                            }
                          >
                            <option>Medicare</option>
                            <option>Self funded</option>
                            <option>NDIS</option>
                          </select>
                        </label>
                        <label>
                          <span>
                            Preferred language <small>Optional</small>
                          </span>
                          <input
                            value={languageOrAccess}
                            onChange={(event) =>
                              setLanguageOrAccess(event.target.value)
                            }
                            placeholder="e.g. English"
                          />
                        </label>
                        <label className="full-width">
                          <span>Accessibility notes (optional)</span>
                          <textarea
                            maxLength={500}
                            value={accessNotes}
                            onChange={(event) =>
                              setAccessNotes(event.target.value)
                            }
                            placeholder="e.g. Step-free access needed. Do not include patient names or contact details."
                          />
                        </label>
                      </div>
                    </fieldset>
                    <div className="form-actions">
                      <button
                        type="button"
                        className="button secondary"
                        onClick={goHome}
                      >
                        Cancel
                      </button>
                      <button
                        className="button primary"
                        disabled={draftPending}
                      >
                        Find practitioners <ArrowRight size={16} />
                      </button>
                    </div>
                  </form>
                  <aside className="referral-context">
                    <div className="context-label">
                      <ClipboardList size={17} />
                      <span>Your referral</span>
                    </div>

                    <p>
                      You’ll review the practitioner and confirm consent before
                      recording anything.
                    </p>
                    <dl>
                      <div>
                        <dt>Patient reference</dt>
                        <dd>{patientReference || "Not entered yet"}</dd>
                      </div>
                      <div>
                        <dt>Profession</dt>
                        <dd>{professionLabel(profession)}</dd>
                      </div>
                      <div>
                        <dt>Funding</dt>
                        <dd>{fundingPath}</dd>
                      </div>
                    </dl>
                    <div className="context-note">
                      <LockKeyhole size={16} />
                      <span>
                        {mode === "preview"
                          ? "Use fictional information in this preview."
                          : "Include only the information needed for this handover."}
                      </span>
                    </div>
                  </aside>
                </div>
              )}

              {step === 2 && (
                <div className="shortlist-layout">
                  <aside className="need-summary">
                    <h2>Referral need</h2>
                    <dl>
                      <div>
                        <dt>Profession</dt>
                        <dd>{professionLabel(profession)}</dd>
                      </div>
                      <div>
                        <dt>Location</dt>
                        <dd>{postcode}</dd>
                      </div>
                      <div>
                        <dt>Format</dt>
                        <dd>{formatLabel(appointmentFormat)}</dd>
                      </div>
                      <div>
                        <dt>Funding</dt>
                        <dd>{fundingPath}</dd>
                      </div>
                      {languageOrAccess && (
                        <div>
                          <dt>Language</dt>
                          <dd>{languageOrAccess}</dd>
                        </div>
                      )}
                    </dl>
                    <button className="text-button" onClick={() => setStep(1)}>
                      Edit referral need
                    </button>
                  </aside>
                  <section className="shortlist-main">
                    <div className="section-heading">
                      <div>
                        <h2>
                          {matches.length} eligible{" "}
                          {matches.length === 1
                            ? "practitioner"
                            : "practitioners"}
                        </h2>
                        <p>
                          Matches your funding, format and language preferences.
                          Distance ranking is not available yet. Check the
                          practice location before choosing.
                        </p>
                      </div>
                    </div>
                    {matches.length === 0 ? (
                      <div className="no-matches">
                        <h3>No eligible practitioners found</h3>
                        <p>
                          Only active, registration-verified and
                          provider-confirmed profiles accepting referrals can
                          appear. Try changing the format, funding or language
                          preference.
                        </p>
                        {mode === "preview" && !demoMode && (
                          <button
                            className="button secondary"
                            onClick={loadDemoWorkspace}
                          >
                            Load demo workspace
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="provider-list">
                        {matches.map(({ practitioner, reasons }) => (
                          <label
                            className={`provider-row ${selectedPractitionerId === practitioner.id ? "selected" : ""}`}
                            key={practitioner.id}
                          >
                            <input
                              type="radio"
                              name="practitioner"
                              checked={
                                selectedPractitionerId === practitioner.id
                              }
                              onChange={() =>
                                setSelectedPractitionerId(practitioner.id)
                              }
                            />
                            <span className="provider-name">
                              <strong>{practitioner.displayName}</strong>
                              <small>{practitioner.practiceName}</small>
                            </span>
                            <span>
                              <strong>
                                {practitioner.location
                                  ? `${practitioner.location.suburb} ${practitioner.location.postcode}`
                                  : practitioner.telehealth
                                    ? "Telehealth"
                                    : "Location not provided"}
                              </strong>
                              <small>
                                {practitioner.services.slice(0, 2).join(" · ")}
                              </small>
                            </span>
                            <ul>
                              {reasons.slice(0, 4).map((reason) => (
                                <li key={reason}>
                                  <Check size={12} />
                                  {reason}
                                </li>
                              ))}
                            </ul>
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="form-actions">
                      <button
                        className="button secondary"
                        onClick={() => setStep(1)}
                      >
                        Back
                      </button>
                      <button
                        className="button primary"
                        disabled={!selectedPractitionerId}
                        onClick={() => setStep(3)}
                      >
                        Review referral <ArrowRight size={16} />
                      </button>
                    </div>
                  </section>
                </div>
              )}

              {step === 3 && (
                <div className="review-layout">
                  <section className="review-card">
                    <h2>Referral details</h2>
                    <dl>
                      <div>
                        <dt>Patient reference</dt>
                        <dd>{patientReference}</dd>
                      </div>
                      <div>
                        <dt>Reason</dt>
                        <dd>{clinicalSummary}</dd>
                      </div>
                      <div>
                        <dt>Profession</dt>
                        <dd>{professionLabel(profession)}</dd>
                      </div>
                      <div>
                        <dt>Practitioner</dt>
                        <dd>
                          {selectedPractitioner?.displayName}
                          <small>{selectedPractitioner?.practiceName}</small>
                        </dd>
                      </div>
                      <div>
                        <dt>Access</dt>
                        <dd>
                          {fundingPath} · {formatLabel(appointmentFormat)}
                          {languageOrAccess ? ` · ${languageOrAccess}` : ""}
                        </dd>
                      </div>
                    </dl>
                    <button
                      className="text-button"
                      disabled={saving || submissionPending}
                      onClick={() => setStep(1)}
                    >
                      Edit referral
                    </button>
                  </section>
                  <aside className="send-card">
                    <h2>Record referral</h2>
                    <p>
                      {mode === "preview"
                        ? "This preview will show the next step without saving or sending anything."
                        : "The referral will be saved securely. Email delivery remains off until the sender configuration is approved."}
                    </p>
                    <label className="consent-check">
                      <input
                        type="checkbox"
                        checked={consentConfirmed}
                        disabled={saving || submissionPending}
                        onChange={(event) =>
                          setConsentConfirmed(event.target.checked)
                        }
                      />
                      <span>
                        I confirm the patient has consented and the information
                        is accurate.
                      </span>
                    </label>
                    {submissionPending && !saving && (
                      <p role="status">
                        This save is not yet confirmed. Keep this page open.
                        Check and retry uses the same submission, without
                        changing the details or creating a second referral.
                      </p>
                    )}
                    <button
                      className="button primary full"
                      disabled={!consentConfirmed || saving}
                      onClick={submitReferral}
                    >
                      {saving
                        ? "Saving…"
                        : submissionPending
                          ? "Check and retry"
                          : "Record referral"}
                    </button>
                  </aside>
                </div>
              )}

              {step === 4 && (
                <section className="success-state">
                  <div>
                    <Check size={24} />
                  </div>
                  <p className="eyebrow">Complete</p>
                  <h2>Referral recorded</h2>
                  <p>{deliveryNote}</p>
                  <dl>
                    <div>
                      <dt>Reference</dt>
                      <dd>{detailReferral?.reference}</dd>
                    </div>
                    <div>
                      <dt>Practitioner</dt>
                      <dd>{detailReferral?.providerName}</dd>
                    </div>
                  </dl>
                  <div className="empty-actions">
                    <button className="button secondary" onClick={goHome}>
                      Back to referrals
                    </button>
                    <button
                      className="button primary"
                      onClick={() => setView("detail")}
                    >
                      View referral
                    </button>
                  </div>
                </section>
              )}
            </section>
          )}

          {view === "detail" && detailReferral && (
            <section className="gp-page detail-page">
              <button className="back-link" onClick={goHome}>
                <ArrowLeft size={15} />
                Referrals
              </button>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">{detailReferral.reference}</p>
                  <h1>{detailReferral.patientReference}</h1>
                  <p>{professionLabel(detailReferral.profession)} referral</p>
                </div>
                <span className="status-pill">
                  <i className={`status-dot ${detailReferral.status}`} />
                  {statusLabel(detailReferral.status)}
                </span>
              </div>
              <div className="detail-layout">
                <section className="review-card">
                  <h2>Referral</h2>
                  <dl>
                    <div>
                      <dt>Clinical need</dt>
                      <dd>{detailReferral.clinicalSummary}</dd>
                    </div>
                    <div>
                      <dt>Preferred language</dt>
                      <dd>
                        {detailReferral.preferredLanguage || "Not specified"}
                      </dd>
                    </div>
                    <div>
                      <dt>Accessibility notes</dt>
                      <dd>{detailReferral.accessNotes || "Not specified"}</dd>
                    </div>
                    <div>
                      <dt>Patient postcode</dt>
                      <dd>{detailReferral.patientPostcode}</dd>
                    </div>
                    <div>
                      <dt>Practitioner</dt>
                      <dd>{detailReferral.providerName}</dd>
                    </div>
                    <div>
                      <dt>Funding and format</dt>
                      <dd>
                        {detailReferral.fundingPath} ·{" "}
                        {formatLabel(detailReferral.appointmentFormat)}
                      </dd>
                    </div>
                  </dl>
                </section>
                {client && mode === "authenticated" ? (
                  <ReferralActivity
                    key={detailReferral.id}
                    client={client}
                    referralId={detailReferral.id}
                    refresh={refresh}
                  />
                ) : (
                  <aside className="timeline">
                    <h2>Preview activity</h2>
                    <ol>
                      <li className="done">
                        <i />
                        <div>
                          <strong>Referral recorded</strong>
                          <span>
                            {new Intl.DateTimeFormat("en-AU", {
                              dateStyle: "medium",
                            }).format(new Date(detailReferral.createdAt))}
                          </span>
                        </div>
                      </li>
                      <li className="current">
                        <i />
                        <div>
                          <strong>Current status</strong>
                          <span>{statusLabel(detailReferral.status)}</span>
                        </div>
                      </li>
                      <li>
                        <i />
                        <div>
                          <strong>Appointment</strong>
                          <span>Not yet recorded</span>
                        </div>
                      </li>
                    </ol>
                  </aside>
                )}
              </div>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}

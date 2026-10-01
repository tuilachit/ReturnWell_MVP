"use client";

import {
  ArrowRight,
  ArrowUpRight,
  Clock3,
  ChevronRight,
  Search,
  SlidersHorizontal,
  X,
  ReferralIcon as ClipboardList,
  ReferralIcon as Inbox,
  AttentionIcon as CircleAlert,
  CalendarIcon as CalendarCheck2,
  ComposeIcon as FilePlus2,
} from "./ui-icons";
import type { Referral } from "./types";
import { professionLabel } from "./lib/professions";

export const referralStatusLabel = (status: Referral["status"]) =>
  ({
    sent: "Awaiting response",
    accepted: "Accepted",
    declined: "Needs another option",
    booked: "Appointment booked",
    cancelled: "Cancelled",
  })[status];

type Props = {
  referrals: Referral[];
  filtered: Referral[];
  loading: boolean;
  preview: boolean;
  demo: boolean;
  search: string;
  setSearch: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  onNew: () => void;
  onOpen: (referral: Referral) => void;
  onDemo: () => void;
  onGuide: () => void;
};

export default function ReferralOverview({
  referrals,
  filtered,
  loading,
  preview,
  demo,
  search,
  setSearch,
  status,
  setStatus,
  onNew,
  onOpen,
  onDemo,
  onGuide,
}: Props) {
  const open = referrals.filter(
    (r) => !["booked", "cancelled"].includes(r.status),
  ).length;
  const attention = referrals.filter((r) => r.status === "declined").length;
  const awaiting = referrals.filter((r) => r.status === "sent").length;
  const booked = referrals.filter((r) => r.status === "booked").length;
  const filters = [
    { value: "all", label: "All referrals", count: referrals.length },
    {
      value: "sent",
      label: "Awaiting response",
      count: referrals.filter((r) => r.status === "sent").length,
    },
    {
      value: "accepted",
      label: "Accepted",
      count: referrals.filter((r) => r.status === "accepted").length,
    },
    { value: "declined", label: "Needs attention", count: attention },
    { value: "booked", label: "Booked", count: booked },
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Referrals</h1>
          <p>Manage referrals and follow practitioner responses.</p>
        </div>
        <button className="button primary" onClick={onNew}>
          <FilePlus2 size={17} />
          New referral
        </button>
      </div>

      <section className="summary-strip" aria-label="Referral summary">
        {[
          {
            label: "Open referrals",
            value: open,
            filter: "all",
            icon: Inbox,
            hint: "View all referrals",
          },
          {
            label: "Awaiting response",
            value: awaiting,
            filter: "sent",
            icon: Clock3,
            hint: "View referrals awaiting response",
          },
          {
            label: "Needs attention",
            value: attention,
            filter: "declined",
            icon: CircleAlert,
            hint: "View referrals needing attention",
          },
          {
            label: "Appointments booked",
            value: booked,
            filter: "booked",
            icon: CalendarCheck2,
            hint: "View booked appointments",
          },
        ].map(({ label, value, filter, icon: Icon, hint }) => (
          <button
            key={filter}
            onClick={() => setStatus(filter)}
            aria-label={`${hint}, ${value}`}
          >
            <span className="summary-icon">
              <Icon size={24} aria-hidden="true" />
            </span>
            <strong className="summary-value">{loading ? "—" : value}</strong>
            <span className="summary-label">{label}</span>
            <ArrowUpRight
              size={14}
              className="summary-chevron"
              aria-hidden="true"
            />
          </button>
        ))}
      </section>

      <section className="activity-section">
        <div className="activity-title">
          <h2>
            All referrals <span>{referrals.length}</span>
          </h2>
          <span className="quiet-label">
            {preview ? "Preview workspace" : "Your practice"}
          </span>
        </div>
        <div className="activity-toolbar">
          <div
            className="filter-tabs"
            role="group"
            aria-label="Filter referral status"
          >
            {filters.map((filter) => (
              <button
                key={filter.value}
                className={status === filter.value ? "active" : ""}
                aria-pressed={status === filter.value}
                onClick={() => setStatus(filter.value)}
              >
                {filter.label}
                <span>{filter.count}</span>
              </button>
            ))}
          </div>
          <label className="activity-search">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Search referrals"
              placeholder="Search referrals…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch("")}
              >
                <X size={14} />
              </button>
            )}
          </label>
        </div>
        <div className="referral-table" aria-label="Referrals">
          <div className="referral-table-head">
            <span>Patient / reference</span>
            <span>Referral need</span>
            <span>Practitioner</span>
            <span>Status</span>
            <span>Updated</span>
            <span />
          </div>
          {loading ? (
            <div className="loading-state" role="status">
              <span className="loading-ring" />
              Opening your referrals…
            </div>
          ) : referrals.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon" aria-hidden="true">
                <Inbox size={42} />
              </div>
              <h2>No referrals yet</h2>
              <p>
                Create a referral to find a practitioner and follow their
                response.
              </p>
              <button className="button primary" onClick={onNew}>
                Create your first referral <ArrowRight size={16} />
              </button>
              {preview && (
                <button className="demo-link" onClick={onDemo}>
                  Try fictional demo data <ArrowUpRight size={13} />
                  <span className="sr-only">Load demo workspace</span>
                </button>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <div className="no-matches">
              <SlidersHorizontal size={26} />
              <h3>No referrals match these filters</h3>
              <p>Try a different reference or choose another status.</p>
              <button
                className="button secondary"
                onClick={() => {
                  setSearch("");
                  setStatus("all");
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            filtered.map((referral) => (
              <button
                className="referral-row"
                key={referral.id}
                onClick={() => onOpen(referral)}
              >
                <span className="patient-cell">
                  <span className="patient-avatar">
                    <ClipboardList size={18} />
                  </span>
                  <span>
                    <strong>{referral.patientReference}</strong>
                    <small>{referral.reference}</small>
                  </span>
                </span>
                <span>
                  <strong>
                    {professionLabel(referral.profession)}
                  </strong>
                  <small>{referral.clinicalSummary}</small>
                </span>
                <span>
                  <strong>{referral.providerName}</strong>
                  <small>
                    {referral.appointmentFormat === "in_person"
                      ? "In person"
                      : referral.appointmentFormat === "telehealth"
                        ? "Telehealth"
                        : "In person or telehealth"}
                  </small>
                </span>
                <span>
                  <span className={`status-label ${referral.status}`}>
                    <i className={`status-dot ${referral.status}`} />
                    {referralStatusLabel(referral.status)}
                  </span>
                </span>
                <span className="referral-updated">
                  {new Intl.DateTimeFormat("en-AU", {
                    day: "numeric",
                    month: "short",
                  }).format(new Date(referral.updatedAt))}
                </span>
                <ChevronRight size={16} />
              </button>
            ))
          )}
        </div>
        <footer className="activity-footer">
          <span>
            {demo
              ? "Fictional records · this tab only"
              : referrals.length
                ? `${filtered.length} of ${referrals.length} referrals`
                : "Your referrals will appear here as you create them."}
          </span>
        </footer>
      </section>

      <div className="workspace-help">
        <button onClick={onGuide}>
          How referrals work <ChevronRight size={14} />
        </button>
      </div>
    </>
  );
}

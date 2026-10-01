"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  MapPin,
  Search,
  Video,
  PeopleIcon as Users,
} from "./ui-icons";
import type { Practitioner } from "./types";

export default function PractitionerDirectory({
  practitioners,
  loading,
  error,
  preview,
  demo,
  onDemo,
  onRefer,
  onRetry,
}: {
  practitioners: Practitioner[];
  loading: boolean;
  error: string;
  preview: boolean;
  demo: boolean;
  onDemo: () => void;
  onRefer: (practitioner: Practitioner) => void;
  onRetry: () => void;
}) {
  const [query, setQuery] = useState("");
  const [profession, setProfession] = useState("all");
  const directory = useMemo(
    () =>
      practitioners
        .filter(
          (p) =>
            p.lifecycleStatus === "active" &&
            p.ahpraVerificationStatus === "verified" &&
            p.providerConfirmationStatus === "confirmed" &&
            p.acceptingNewReferrals,
        )
        .filter(
          (p) =>
            (profession === "all" || p.profession === profession) &&
            `${p.displayName} ${p.practiceName} ${p.location?.suburb ?? ""} ${p.location?.postcode ?? ""}`
              .toLowerCase()
              .includes(query.toLowerCase().trim()),
        ),
    [practitioners, profession, query],
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Practitioners</h1>
          <p>Explore confirmed profiles accepting new referrals.</p>
        </div>
        <span className="directory-count">
          <Users size={16} />
          {loading ? "Checking availability…" : error ? "Availability unavailable" : `${directory.length} available`}
        </span>
      </div>
      <section className="directory-panel">
        <div className="directory-toolbar">
          <label className="activity-search">
            <Search size={17} />
            <input
              aria-label="Search practitioners"
              placeholder="Name, practice or suburb"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="Filter practitioner profession"
            value={profession}
            onChange={(e) => setProfession(e.target.value)}
          >
            <option value="all">All professions</option>
            <option value="physiotherapist">Physiotherapy</option>
            <option value="psychologist">Psychology</option>
          </select>
        </div>
        {loading ? (
          <div className="loading-state" role="status">
            Loading practitioners…
          </div>
        ) : error ? (
          <div className="empty-state">
            <CircleAlert size={27} />
            <h2>Couldn’t load practitioners</h2>
            <p role="alert">{error}</p>
            <button className="button secondary" onClick={onRetry}>Try again</button>
          </div>
        ) : directory.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Users size={27} />
            </div>
            <h2>
              {query || profession !== "all"
                ? "No matching practitioners"
                : "No practitioners yet"}
            </h2>
            <p>
              {query || profession !== "all"
                ? "Try another profession, name or location."
                : "Practitioners appear here once their registration and practice details are confirmed."}
            </p>
            {preview && !demo && (
              <button className="button secondary" onClick={onDemo}>
                Load demo workspace
              </button>
            )}
          </div>
        ) : (
          <div className="directory-list">
            {directory.map((p) => (
              <article className="directory-practitioner" key={p.id}>
                <div className="practitioner-avatar">
                  {p.displayName
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")}
                </div>
                <div className="directory-profile">
                  <span className="eyebrow">
                    {p.profession === "physiotherapist"
                      ? "Physiotherapy"
                      : "Psychology"}
                  </span>
                  <h2>{p.displayName}</h2>
                  <p>{p.practiceName}</p>
                  <div className="practitioner-meta">
                    {p.location && (
                      <span>
                        <MapPin size={14} />
                        {p.location.suburb} {p.location.postcode}
                      </span>
                    )}
                    {p.telehealth && (
                      <span>
                        <Video size={14} />
                        Telehealth
                      </span>
                    )}
                  </div>
                  <div className="practitioner-tags">
                    {p.services.map((service) => (
                      <span key={service}>{service}</span>
                    ))}
                  </div>
                  <details>
                    <summary>Funding, languages & verification</summary>
                    <dl>
                      <div>
                        <dt>Funding</dt>
                        <dd>{p.funding.join(" · ") || "Not stated"}</dd>
                      </div>
                      <div>
                        <dt>Languages</dt>
                        <dd>{p.languages.join(" · ") || "Not stated"}</dd>
                      </div>
                      <div>
                        <dt>Verification</dt>
                        <dd>
                          {preview
                            ? "Fictional demonstration profile"
                            : "Registration checked and profile confirmed"}
                        </dd>
                      </div>
                    </dl>
                  </details>
                </div>
                <div className="directory-actions">
                  <span>
                    <Check size={14} />
                    Accepting referrals
                  </span>
                  <button
                    className="button secondary"
                    onClick={() => onRefer(p)}
                  >
                    Start referral <ArrowRight size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <p className="directory-footnote">
        The referral shortlist checks funding, appointment format and language
        against your patient’s needs.
      </p>
    </>
  );
}

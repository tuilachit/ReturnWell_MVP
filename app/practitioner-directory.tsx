"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { usePractitionerSearch } from "./lib/use-practitioner-search";
import type { DistanceGroup } from "./lib/directory";
import DirectoryPages from "./components/directory-pages";
import LocationControls from "./components/location-controls";
import { usePostcodeLocalities } from "./lib/use-postcode-localities";
import { needsGeographyRefresh } from "./lib/workflow-error";
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
import { professionLabel, supportedProfessions } from "./lib/professions";
import { isEligibleForNewReferral } from "./lib/credentials";
import { normalizeTerm } from "./lib/terminology";

export default function PractitionerDirectory({
  practitioners,
  loading,
  error,
  preview,
  demo,
  onDemo,
  onRefer,
  onRetry,
  client = null,
}: {
  practitioners: Practitioner[];
  loading: boolean;
  error: string;
  preview: boolean;
  demo: boolean;
  onDemo: () => void;
  onRefer: (practitioner: Practitioner) => void;
  onRetry: () => void;
  client?: SupabaseClient | null;
}) {
  const [query, setQuery] = useState("");
  const [profession, setProfession] = useState("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [group, setGroup] = useState<DistanceGroup | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [postcode, setPostcode] = useState("");
  const [localityId, setLocalityId] = useState("");
  const [radius, setRadius] = useState("");
  const location = usePostcodeLocalities(client, postcode, localityId);
  const remote = usePractitionerSearch(location.loading ? null : client, {
    query,
    professionId: profession === "all" ? undefined : profession,
    cursor,
    distanceGroup: group,
    refresh,
    postcode: /^[0-9]{4}$/.test(postcode) ? postcode : undefined,
    localityId: location.selected?.hasCoordinates ? localityId : undefined,
    radiusKm: location.selected?.hasCoordinates && radius ? Number(radius) : undefined,
  });
  const shownLoading = client ? remote.loading || location.loading : loading;
  const shownError = client ? remote.error : error;
  const directory = useMemo(
    () =>
      client
        ? remote.page.items.map((item) => item.practitioner)
        : practitioners
            .filter((p) => isEligibleForNewReferral(p, p.profession))
            .filter(
              (p) =>
                (profession === "all" || p.profession === profession) &&
                `${p.displayName} ${p.practiceName} ${p.location?.suburb ?? ""} ${p.location?.postcode ?? ""}`
                  .toLowerCase()
                  .includes(query.toLowerCase().trim()),
            ),
    [client, remote.page, practitioners, profession, query],
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
          {shownLoading
            ? "Checking availability…"
            : shownError
              ? "Availability unavailable"
              : `${client ? remote.page.totalEligible : directory.length} available`}
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
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(null);
                setGroup(null);
              }}
            />
          </label>
          <select
            aria-label="Filter practitioner profession"
            value={profession}
            onChange={(e) => {
              setProfession(e.target.value);
              setCursor(null);
              setGroup(null);
            }}
          >
            <option value="all">All professions</option>
            {supportedProfessions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {client && <div className="directory-location">
          <label><span>Near postcode (optional)</span><input aria-label="Near postcode" inputMode="numeric" maxLength={4} value={postcode} placeholder="e.g. 2000" onChange={e => { setPostcode(e.target.value.replace(/\D/g, "")); setLocalityId(""); setRadius(""); setCursor(null); setGroup(null); }} /></label>
          <LocationControls postcode={postcode} localityId={localityId} radius={radius} location={location}
            onLocality={value => { setLocalityId(value); setRadius(""); setCursor(null); setGroup(null); }}
            onRadius={value => { setRadius(value); setCursor(null); setGroup(null); }} />
        </div>}
        {client && (
          <DirectoryPages
            page={remote.page}
            group={remote.group}
            busy={shownLoading}
            hasCursor={Boolean(cursor)}
            onGroup={(value) => {
              setGroup(value);
              setCursor(null);
            }}
            onFirst={() => setCursor(null)}
            onNext={() => {
              setGroup(remote.group);
              setCursor(remote.page.nextCursor);
            }}
          />
        )}
        {shownLoading ? (
          <div className="loading-state" role="status">
            Loading practitioners…
          </div>
        ) : shownError ? (
          <div className="empty-state">
            <CircleAlert size={27} />
            <h2>Couldn’t load practitioners</h2>
            <p role="alert">{shownError}</p>
            <button
              className="button secondary"
              onClick={() => {
                if (needsGeographyRefresh(remote.errorCode)) {
                  location.retry();
                  setLocalityId("");
                  setRadius("");
                  setCursor(null);
                  setGroup(null);
                }
                setRefresh((value) => value + 1);
                onRetry();
              }}
            >
              Try again
            </button>
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
                    {professionLabel(p.profession)}
                  </span>
                  <h2>{p.displayName}</h2>
                  <p>{p.practiceName}</p>
                  <div className="practitioner-meta">
                    {p.location && (
                      <span>
                        <MapPin size={14} />
                        {p.location.suburb} {p.location.postcode}
                        {client && p.distanceKm !== null && <> · Approx. {p.distanceKm.toFixed(1)} km</>}
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
                        <dd>
                          {p.funding
                            .map(
                              (value) =>
                                normalizeTerm("funding", value)?.label ??
                                `${value} (needs clarification)`,
                            )
                            .join(" · ") || "Not stated"}
                          . Confirm fees and rebate eligibility directly.
                        </dd>
                      </div>
                      <div>
                        <dt>Languages</dt>
                        <dd>
                          {p.languages
                            .map(
                              (value) =>
                                normalizeTerm("language", value)?.label ??
                                value,
                            )
                            .join(" · ") || "Not stated"}
                        </dd>
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

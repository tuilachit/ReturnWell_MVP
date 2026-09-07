"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Search, X } from "lucide-react";

type Location = { address: string | null; suburb: string | null; postcode: string | null; state: string | null; sourceUrl: string | null };
export type Practitioner = {
  id: string; targetNumber: number; name: string; profession: string;
  practices: string[]; roleTitles: string[]; websites: string[]; phones: string[]; emails: string[];
  locations: Location[]; profileUrls: string[]; services: string[]; funding: string[]; languages: string[];
  telehealth: boolean | string | null; acceptingNewReferrals: boolean | string | null; sources: string[];
  professionEvidence: string[]; zones: string[]; identityReview: string; reviewStatus: string;
  ahpraRegistrationNumber: string | null; ahpraVerificationStatus: string; ahpraVerifiedAt: string | null;
  providerConfirmationStatus: string; providerConfirmedAt: string | null;
};

type ReviewOutcome = "verified" | "issue" | "no_match";
type Tab = "review" | "match" | "imports";

const PAGE_SIZE = 15;
const titleCase = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const primaryLocation = (record: Practitioner) => {
  const location = record.locations.find((item) => item.suburb || item.postcode);
  return location ? [location.suburb, location.state, location.postcode].filter(Boolean).join(" ") : "Needs review";
};
const explicitYes = (value: Practitioner["telehealth"]) => value === true || ["yes", "true"].includes(String(value).toLowerCase());
const displayObserved = (value: Practitioner["telehealth"]) => {
  if (value === null) return "Not stated by source";
  if (value === true || value === "true") return "Yes — source stated";
  if (value === false || value === "false") return "No — source stated";
  return String(value);
};

export default function Workbench({ records }: { records: Practitioner[] }) {
  const [tab, setTab] = useState<Tab>("review");
  const [query, setQuery] = useState("");
  const [profession, setProfession] = useState("all");
  const [zone, setZone] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Practitioner | null>(null);
  const [reviewOutcomes, setReviewOutcomes] = useState<Record<string, ReviewOutcome>>({});
  const [matchProfession, setMatchProfession] = useState("physiotherapist");
  const [matchPostcode, setMatchPostcode] = useState("");
  const [matchZone, setMatchZone] = useState("all");
  const [matchFunding, setMatchFunding] = useState("all");
  const [matchTelehealth, setMatchTelehealth] = useState(false);

  const zones = useMemo(() => [...new Set(records.flatMap((record) => record.zones))].sort(), [records]);
  const fundingOptions = useMemo(() => [...new Set(records.flatMap((record) => record.funding))].sort(), [records]);
  const filteredRecords = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter((record) => {
      const searchable = [record.name, ...record.practices, ...record.locations.flatMap((item) => [item.suburb, item.postcode])].filter(Boolean).join(" ").toLowerCase();
      return (!needle || searchable.includes(needle)) && (profession === "all" || record.profession === profession) && (zone === "all" || record.zones.includes(zone));
    });
  }, [profession, query, records, zone]);

  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const visibleRecords = filteredRecords.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const reviewedCount = Object.keys(reviewOutcomes).length;

  const matchResults = useMemo(() => {
    const postcode = matchPostcode.trim();
    return records
      .filter((record) => record.profession === matchProfession)
      .filter((record) => matchZone === "all" || record.zones.includes(matchZone))
      .filter((record) => !postcode || record.locations.some((item) => item.postcode === postcode))
      .filter((record) => matchFunding === "all" || record.funding.includes(matchFunding))
      .filter((record) => !matchTelehealth || explicitYes(record.telehealth))
      .map((record) => {
        const reasons: string[] = [];
        let score = 40;
        if (postcode && record.locations.some((item) => item.postcode === postcode)) { score += 35; reasons.push(`postcode ${postcode}`); }
        if (matchZone !== "all") { score += 15; reasons.push(matchZone); }
        if (matchFunding !== "all") { score += 10; reasons.push(matchFunding); }
        if (matchTelehealth) { score += 10; reasons.push("telehealth stated"); }
        if (record.locations.some((item) => item.postcode)) score += 5;
        if (record.services.length) score += 3;
        if (!reasons.length) reasons.push("profession only");
        return { record, score, reasons };
      })
      .sort((left, right) => right.score - left.score || left.record.name.localeCompare(right.record.name))
      .slice(0, 20);
  }, [matchFunding, matchPostcode, matchProfession, matchTelehealth, matchZone, records]);

  const practices = useMemo(() => new Set(records.flatMap((record) => record.practices)).size, [records]);
  const locations = useMemo(() => new Set(records.flatMap((record) => record.locations.map((item) => [item.address, item.suburb, item.postcode].join("|")))).size, [records]);
  const sources = useMemo(() => new Set(records.flatMap((record) => record.sources)).size, [records]);
  const postcodeCoverage = Math.round(records.filter((record) => record.locations.some((item) => item.postcode)).length / records.length * 100);
  const openNextReview = () => {
    const next = filteredRecords.find((record) => !reviewOutcomes[record.id]) ?? filteredRecords[0];
    if (next) setSelected(next);
  };

  const navItems: { id: Tab; label: string }[] = [
    { id: "review", label: "Review queue" },
    { id: "match", label: "Match test" },
    { id: "imports", label: "Import report" },
  ];

  return (
    <main className="product-shell">
      <header className="app-header">
        <div className="brand-line">
          <button className="wordmark" onClick={() => setTab("review")}>ReturnWell</button>
          <span className="product-name">Practitioner workbench</span>
        </div>
        <div className="workspace-meta"><span>Private workspace</span><span>Sydney pilot</span><b>RW</b></div>
      </header>

      <nav className="primary-nav" aria-label="Workbench sections">
        {navItems.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}
      </nav>

      {tab === "review" && <section className="page">
        <div className="page-intro">
          <div><p className="kicker">Sydney practitioner pilot</p><h1>Review practitioners</h1><p>Resolve identity and registration before any profile is considered for publication.</p></div>
          <button className="action-primary" onClick={openNextReview}>Start next review</button>
        </div>

        <div className="summary-line" aria-label="Queue summary">
          <span><strong>{records.length}</strong> Total candidates</span>
          <span><strong>{records.length - reviewedCount}</strong> Awaiting AHPRA</span>
          <span><strong>0</strong> Provider confirmed</span>
          <span><strong>0</strong> Active in directory</span>
        </div>

        <div className="safety-note" role="status">
          <strong>These records are private and unverified.</strong>
          <span>Candidate data only. No practitioner is visible to GPs until registration and profile details are confirmed.</span>
        </div>

        <div className="table-toolbar">
          <div className="table-title"><h2>Candidate register</h2><span>{filteredRecords.length} records</span></div>
          <div className="filters">
            <label className="search-field"><Search size={15} aria-hidden="true" /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} aria-label="Search candidates" placeholder="Search name, practice or postcode" /></label>
            <select aria-label="Filter by profession" value={profession} onChange={(event) => { setProfession(event.target.value); setPage(1); }}><option value="all">All professions</option><option value="physiotherapist">Physiotherapy</option><option value="psychologist">Psychology</option></select>
            <select aria-label="Filter by Sydney zone" value={zone} onChange={(event) => { setZone(event.target.value); setPage(1); }}><option value="all">All areas</option>{zones.map((item) => <option key={item}>{item}</option>)}</select>
          </div>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Practitioner</th><th>Profession</th><th>Practice</th><th>Location</th><th>Source record</th><th>Review</th></tr></thead>
            <tbody>{visibleRecords.length ? visibleRecords.map((record) => {
              const outcome = reviewOutcomes[record.id];
              return <tr key={record.id}>
                <td><button className="name-button" onClick={() => setSelected(record)}>{record.name}</button><small>Candidate {String(record.targetNumber).padStart(3, "0")}</small></td>
                <td>{titleCase(record.profession)}</td>
                <td><span className="truncate-cell">{record.practices.join(" · ") || "Needs review"}</span></td>
                <td>{primaryLocation(record)}</td>
                <td><span className="plain-status"><i className={outcome ? `dot ${outcome}` : "dot"} />{outcome ? titleCase(outcome) : "Not checked"}</span></td>
                <td><button className="text-action" onClick={() => setSelected(record)}>Open record</button></td>
              </tr>;
            }) : <tr><td colSpan={6} className="empty-row">No candidates match these filters.</td></tr>}</tbody>
          </table>
        </div>
        <div className="table-footer"><span>Page {page} of {pageCount}</span><div><button disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={14} /> Previous</button><button disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next <ChevronRight size={14} /></button></div></div>
      </section>}

      {tab === "match" && <section className="page">
        <div className="page-intro narrow-intro"><div><p className="kicker">Internal test</p><h1>Match test</h1><p>Apply only source-stated fields to a fictional referral scenario.</p></div></div>
        <div className="safety-note warning"><strong>Not a clinical recommendation.</strong><span>Distance ranking is unavailable until locations are geocoded. Every result still requires verification.</span></div>

        <form className="filter-sheet" onSubmit={(event) => event.preventDefault()}>
          <label><span>Profession</span><select value={matchProfession} onChange={(event) => setMatchProfession(event.target.value)}><option value="physiotherapist">Physiotherapist</option><option value="psychologist">Psychologist</option></select></label>
          <label><span>Postcode</span><input inputMode="numeric" maxLength={4} value={matchPostcode} onChange={(event) => setMatchPostcode(event.target.value.replace(/\D/g, ""))} placeholder="Any" /></label>
          <label><span>Sydney area</span><select value={matchZone} onChange={(event) => setMatchZone(event.target.value)}><option value="all">Any area</option>{zones.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>Funding</span><select value={matchFunding} onChange={(event) => setMatchFunding(event.target.value)}><option value="all">Any</option>{fundingOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="checkbox-field"><input type="checkbox" checked={matchTelehealth} onChange={(event) => setMatchTelehealth(event.target.checked)} /><span>Telehealth stated</span></label>
          <button type="button" className="clear-button" onClick={() => { setMatchPostcode(""); setMatchZone("all"); setMatchFunding("all"); setMatchTelehealth(false); }}>Clear</button>
        </form>

        <div className="table-toolbar results-toolbar"><div className="table-title"><h2>Shortlist</h2><span>{matchResults.length} source-backed results</span></div><span className="quiet-label">Private test data</span></div>
        <div className="table-scroll">
          <table className="data-table match-table">
            <thead><tr><th>Practitioner</th><th>Practice</th><th>Location</th><th>Evidence used</th><th>Fit</th><th /></tr></thead>
            <tbody>{matchResults.length ? matchResults.map(({ record, score, reasons }) => <tr key={record.id}>
              <td><button className="name-button" onClick={() => setSelected(record)}>{record.name}</button><small>{titleCase(record.profession)}</small></td>
              <td><span className="truncate-cell">{record.practices.join(" · ") || "Needs review"}</span></td>
              <td>{primaryLocation(record)}</td>
              <td>{reasons.join(" · ")}</td>
              <td><strong className="score-text">{Math.min(score, 100)}</strong> / 100</td>
              <td><button className="text-action" onClick={() => setSelected(record)}>View evidence</button></td>
            </tr>) : <tr><td colSpan={6} className="empty-row">No exact source-backed matches. Remove an optional filter to broaden the test.</td></tr>}</tbody>
          </table>
        </div>
      </section>}

      {tab === "imports" && <section className="page">
        <div className="page-intro"><div><p className="kicker">Data foundation</p><h1>Import report</h1><p>The Sydney sample is normalized for a private database import.</p></div><a className="action-primary" href="/returnwell-import-bundle.json" download>Download JSON</a></div>
        <div className="safety-note"><strong>Import bundle ready.</strong><span>The import does not activate or publish any practitioner.</span></div>

        <section className="report-section"><h2>Snapshot</h2><dl className="report-grid"><div><dt>Practitioners</dt><dd>{records.length}</dd><small>100 physiotherapists, 100 psychologists</small></div><div><dt>Practices</dt><dd>{practices}</dd><small>Normalized practice identities</small></div><div><dt>Location records</dt><dd>{locations}</dd><small>Address evidence retained</small></div><div><dt>Unique sources</dt><dd>{sources}</dd><small>Website provenance retained</small></div></dl></section>

        <section className="report-section"><h2>Readiness</h2><table className="report-table"><tbody><tr><th>Profession and practice evidence</th><td>200 / 200</td><td>Ready</td></tr><tr><th>Suburb and postcode coverage</th><td>{postcodeCoverage}%</td><td>Review gaps</td></tr><tr><th>AHPRA registration verified</th><td>0 / 200</td><td>Not started</td></tr><tr><th>Practitioner confirmed</th><td>0 / 200</td><td>Not started</td></tr><tr><th>Active in directory</th><td>0</td><td>Blocked by workflow</td></tr></tbody></table></section>

        <p className="report-footnote">Schema: practitioners, practices, locations, affiliations, source evidence and explicit attributes. Published profiles: 0.</p>
      </section>}

      {selected && <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-header"><div><p>Candidate {String(selected.targetNumber).padStart(3, "0")}</p><h2 id="drawer-title">{selected.name}</h2><span>{titleCase(selected.profession)} · {selected.practices.join(" · ") || "Practice needs review"}</span></div><button onClick={() => setSelected(null)} aria-label="Close review"><X size={18} /></button></header>
        <div className="drawer-note"><strong>Session-only prototype.</strong> Review outcomes are not saved to the dataset.</div>
        <div className="drawer-body">
          <section><h3>Identity</h3><dl><div><dt>Role</dt><dd>{selected.roleTitles.join(", ") || "Not stated"}</dd></div><div><dt>Practice location</dt><dd>{selected.locations.map((item) => [item.address, item.suburb, item.state, item.postcode].filter(Boolean).join(", ")).filter(Boolean).join(" · ") || "Not stated"}</dd></div><div><dt>Identity review</dt><dd>{titleCase(selected.identityReview)}</dd></div></dl></section>
          <section><h3>Source-stated fields</h3><dl><div><dt>Services</dt><dd>{selected.services.join(", ") || "Not stated by source"}</dd></div><div><dt>Funding</dt><dd>{selected.funding.join(", ") || "Not stated by source"}</dd></div><div><dt>Languages</dt><dd>{selected.languages.join(", ") || "Not stated by source"}</dd></div><div><dt>Telehealth</dt><dd>{displayObserved(selected.telehealth)}</dd></div><div><dt>New referrals</dt><dd>{displayObserved(selected.acceptingNewReferrals)}</dd></div></dl></section>
          <section><h3>Profession evidence</h3>{selected.professionEvidence.map((item, index) => <blockquote key={`${item}-${index}`}>{item}</blockquote>)}<div className="source-links">{selected.sources.map((source, index) => <a href={source} target="_blank" rel="noreferrer" key={source}>Source {index + 1} <ExternalLink size={12} /></a>)}</div></section>
          <section><h3>AHPRA</h3><dl><div><dt>Registration number</dt><dd>{selected.ahpraRegistrationNumber || "Not collected"}</dd></div><div><dt>Review status</dt><dd>{reviewOutcomes[selected.id] ? `${titleCase(reviewOutcomes[selected.id])} (session only)` : "Not checked"}</dd></div></dl><p className="helper-copy">Check the official register manually. Do not infer identity from name alone.</p></section>
        </div>
        <footer className="drawer-actions"><button onClick={() => setReviewOutcomes((current) => ({ ...current, [selected.id]: "no_match" }))}>No confident match</button><button className="danger-action" onClick={() => setReviewOutcomes((current) => ({ ...current, [selected.id]: "issue" }))}>Needs investigation</button><button className="confirm-action" onClick={() => setReviewOutcomes((current) => ({ ...current, [selected.id]: "verified" }))}>Stage as verified</button></footer>
      </aside></div>}
    </main>
  );
}

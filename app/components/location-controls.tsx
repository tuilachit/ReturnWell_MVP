import type { usePostcodeLocalities } from "../lib/use-postcode-localities";

export default function LocationControls({ postcode, localityId, radius, location, onLocality, onRadius, telehealth = false }: {
  postcode: string;
  localityId: string;
  radius: string;
  location: ReturnType<typeof usePostcodeLocalities>;
  onLocality: (value: string) => void;
  onRadius: (value: string) => void;
  telehealth?: boolean;
}) {
  if (telehealth) return <p className="location-note">Telehealth results are not ranked or limited by distance.</p>;
  return <div className="location-controls">
    <div className="form-grid">
      <label>
        <span>Patient suburb (NSW)</span>
        <select value={location.selected ? localityId : ""} disabled={location.loading || !location.localities.length} onChange={e => onLocality(e.target.value)}>
          <option value="">{location.loading ? "Looking up suburbs…" : "Browse without distance"}</option>
          {location.localities.map(item => <option key={item.id} value={item.id}>{item.suburb} {item.postcode}{!item.hasCoordinates ? " — distance unavailable" : ""}</option>)}
        </select>
      </label>
      <label>
        <span>Approximate radius</span>
        <select value={location.selected?.hasCoordinates ? radius : ""} disabled={!location.selected?.hasCoordinates} onChange={e => onRadius(e.target.value)}>
          <option value="">Any distance</option>
          {[5, 10, 25, 50, 100, 250, 500].map(km => <option key={km} value={km}>Within {km} km</option>)}
        </select>
      </label>
    </div>
    <p className="location-note" role="status">
      {location.loading ? "Checking the postcode reference…" : location.error ? location.error : !/^[0-9]{4}$/.test(postcode)
        ? "Enter a four-digit postcode to look up suburbs."
        : !location.source ? "Distance matching is not configured yet. You can still browse reviewed suburbs and postcodes."
        : !location.localities.length ? "No reference location was found for this postcode. You can still browse without distance."
        : localityId && !location.selected ? "The saved suburb is no longer in this reference. Choose a suburb again, or browse without distance."
        : !location.selected ? "Confirm the patient's suburb. A postcode can cover more than one place."
        : !location.selected.hasCoordinates ? "This suburb has no reference coordinates. Distance and radius are unavailable."
        : "Straight-line distance between suburb reference points, not travel distance or exact addresses. Unknown-distance options stay separate."}
      {location.error && <> <button type="button" className="button secondary" onClick={location.retry}>Retry suburb lookup</button></>}
      {localityId && !location.selected && !location.loading && <> <button type="button" className="button secondary" onClick={() => onLocality("")}>Clear saved suburb</button></>}
    </p>
  </div>;
}

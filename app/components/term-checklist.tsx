import terms from "../../shared/terminology.json";
import { normalizeTerm } from "../lib/terminology";
export default function TermChecklist({
  kind,
  label,
  values,
  onChange,
}: {
  kind: "funding" | "language" | "service" | "ageGroup";
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const unknown = values.filter((value) => !normalizeTerm(kind, value));
  return (
    <fieldset>
      <legend>{label}</legend>
      {terms[kind].map((term) => (
        <label className="consent-check" key={term.id}>
          <input
            type="checkbox"
            checked={values.some(
              (value) => normalizeTerm(kind, value)?.id === term.id,
            )}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...values, term.id]
                  : values.filter(
                      (value) => normalizeTerm(kind, value)?.id !== term.id,
                    ),
              )
            }
          />
          {term.label}
        </label>
      ))}
      {unknown.length > 0 && (
        <div>
          <p>
            These older entries need clarification before review. Select the
            correct options above and remove each unclear entry.
          </p>
          {unknown.map((value) => (
            <p key={value}>
              {value}{" "}
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  onChange(values.filter((item) => item !== value))
                }
              >
                Remove unclear entry
              </button>
            </p>
          ))}
        </div>
      )}
    </fieldset>
  );
}

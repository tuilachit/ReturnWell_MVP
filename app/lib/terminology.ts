import catalogue from "../../shared/terminology.json" with { type: "json" };
type Kind = "funding" | "language" | "service" | "ageGroup";
const key = (value: string) => value.trim().toLocaleLowerCase("en-AU");
export function normalizeTerm(kind: Kind, value: string): {id: string; label: string} | null {
  const found = catalogue[kind].filter(term => [term.id, term.label, ...term.aliases].some(alias => key(alias) === key(value)));
  return found.length === 1 ? {id: found[0].id, label: found[0].label} : null;
}

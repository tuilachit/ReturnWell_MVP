import catalogue from "../shared/terminology.json" with { type: "json" };
// Outputs reviewed reference terms only; contains no people or activation flags.
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
export const terminologySeed = Object.entries(catalogue)
  .filter(([kind]) => kind !== "version")
  .flatMap(([kind, terms]) =>
    terms.map(
      (term) =>
        `(${quote(kind)},${quote(term.id)},${quote(term.label)},array[${[...new Set([term.id, term.label, ...term.aliases].map((x) => x.trim().toLowerCase()))].map(quote).join(",")}],${catalogue.version})`,
    ),
  )
  .join(",\n");
if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file://").href
)
  console.log(terminologySeed);

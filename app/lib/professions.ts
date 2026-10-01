import catalogue from "../../shared/professions.json" with { type: "json" };

export type ProfessionDefinition = {
  id: string;
  label: string;
  route: "ahpra" | "professional_body";
  authorityId: string;
  scope: "supported" | "review_required" | "out_of_scope";
  credentialLabel: string;
  sourceUrls: string[];
};
export const professions = catalogue.professions as ProfessionDefinition[];
export const supportedProfessions = professions.filter(p => p.scope === "supported");
export const getProfession = (id: string) => professions.find(p => p.id === id);
export const professionLabel = (id: string) => getProfession(id)?.label ?? `Unsupported profession (${id})`;
export const isSupportedProfession = (id: string) => getProfession(id)?.scope === "supported";

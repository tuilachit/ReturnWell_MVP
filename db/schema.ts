import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const practitioners = sqliteTable(
  "practitioners",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    profession: text("profession", { enum: ["physiotherapist", "psychologist"] }).notNull(),
    lifecycleStatus: text("lifecycle_status", { enum: ["candidate", "ahpra_verified", "invited", "provider_confirmed", "active", "rejected"] }).notNull().default("candidate"),
    reviewStatus: text("review_status").notNull(),
    identityReview: text("identity_review").notNull(),
    ahpraRegistrationNumber: text("ahpra_registration_number"),
    ahpraVerificationStatus: text("ahpra_verification_status").notNull().default("not_checked"),
    ahpraVerifiedAt: text("ahpra_verified_at"),
    providerConfirmationStatus: text("provider_confirmation_status").notNull().default("not_contacted"),
    providerConfirmedAt: text("provider_confirmed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_practitioners_ahpra_number").on(table.ahpraRegistrationNumber),
    index("idx_practitioners_profession_lifecycle").on(table.profession, table.lifecycleStatus),
    index("idx_practitioners_verification_queue").on(table.ahpraVerificationStatus, table.reviewStatus),
  ],
);

export const practices = sqliteTable(
  "practices",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    website: text("website"),
    businessPhone: text("business_phone"),
    businessEmail: text("business_email"),
  },
  (table) => [uniqueIndex("idx_practices_website_name").on(table.website, table.name)],
);

export const practiceLocations = sqliteTable(
  "practice_locations",
  {
    id: text("id").primaryKey(),
    practiceId: text("practice_id").notNull().references(() => practices.id, { onDelete: "cascade" }),
    address: text("address"),
    suburb: text("suburb"),
    postcode: text("postcode"),
    state: text("state").notNull().default("NSW"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    sourceUrl: text("source_url"),
  },
  (table) => [
    index("idx_practice_locations_practice").on(table.practiceId),
    index("idx_practice_locations_postcode").on(table.postcode),
    index("idx_practice_locations_coordinates").on(table.latitude, table.longitude),
  ],
);

export const practitionerPractices = sqliteTable(
  "practitioner_practices",
  {
    practitionerId: text("practitioner_id").notNull().references(() => practitioners.id, { onDelete: "cascade" }),
    practiceId: text("practice_id").notNull().references(() => practices.id, { onDelete: "cascade" }),
    roleTitle: text("role_title"),
    profileUrl: text("profile_url"),
    professionEvidence: text("profession_evidence"),
  },
  (table) => [
    primaryKey({ columns: [table.practitionerId, table.practiceId] }),
    index("idx_practitioner_practices_practice").on(table.practiceId),
  ],
);

export const practitionerEvidence = sqliteTable(
  "practitioner_evidence",
  {
    id: text("id").primaryKey(),
    practitionerId: text("practitioner_id").notNull().references(() => practitioners.id, { onDelete: "cascade" }),
    fieldName: text("field_name").notNull(),
    observedValue: text("observed_value"),
    sourceUrl: text("source_url").notNull(),
    sourceType: text("source_type").notNull(),
    confidence: text("confidence").notNull(),
    observedAt: text("observed_at"),
  },
  (table) => [index("idx_practitioner_evidence_practitioner_field").on(table.practitionerId, table.fieldName)],
);

export const practitionerAttributes = sqliteTable(
  "practitioner_attributes",
  {
    id: text("id").primaryKey(),
    practitionerId: text("practitioner_id").notNull().references(() => practitioners.id, { onDelete: "cascade" }),
    attributeType: text("attribute_type", { enum: ["service", "funding", "language", "telehealth", "accepting_new_referrals"] }).notNull(),
    observedValue: text("observed_value").notNull(),
    providerConfirmed: integer("provider_confirmed", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [index("idx_practitioner_attributes_type_value").on(table.attributeType, table.observedValue)],
);

export const verificationEvents = sqliteTable(
  "verification_events",
  {
    id: text("id").primaryKey(),
    practitionerId: text("practitioner_id").notNull().references(() => practitioners.id, { onDelete: "cascade" }),
    verificationType: text("verification_type", { enum: ["ahpra", "provider_confirmation", "activation_review"] }).notNull(),
    outcome: text("outcome", { enum: ["verified", "issue", "no_match", "confirmed", "rejected"] }).notNull(),
    registrationNumber: text("registration_number"),
    notes: text("notes"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: text("reviewed_at").notNull(),
  },
  (table) => [index("idx_verification_events_practitioner_date").on(table.practitionerId, table.reviewedAt)],
);

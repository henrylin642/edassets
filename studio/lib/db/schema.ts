/**
 * AR Assets Studio — database schema (Drizzle / Postgres).
 *
 * Three tables (PRD §6):
 *   scenario        — a situational pack (便利商店, 咖啡店…)
 *   asset           — one reusable AR asset (keyword image/3D or scene object)
 *   generation_job  — per-stage generation attempt log (image | model | upload)
 *
 * Idempotency: assets are globally reusable; (type, tag_key) is unique so the
 * same concept is never generated twice. scenario_id records the *origin*
 * scenario only — reuse across scenarios happens via tags.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  unique,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

// ── Enums ──────────────────────────────────────────────────────────────
export const arcType = pgEnum("arc_type", ["ATTRIBUTE", "SITUATION", "BEHAVIOR"]);
export const scenarioSource = pgEnum("scenario_source", ["ai", "manual"]);
export const assetType = pgEnum("asset_type", ["scene_object", "keyword"]);
/** concrete → render as single object (+ eligible for 3D); abstract → illustration only */
export const semanticClass = pgEnum("semantic_class", ["concrete", "abstract"]);
export const assetStatus = pgEnum("asset_status", [
  "pending", // created/edited but idle — NOT auto-generated
  "queued", // user asked to generate → background worker will pick it up
  "generating",
  "review",
  "uploaded",
  "failed",
]);
export const jobStage = pgEnum("job_stage", ["image", "model", "upload"]);
export const jobStatus = pgEnum("job_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);
/** image-to-3D lifecycle (per-asset, user-triggered) */
export const modelStatus = pgEnum("model_status", [
  "none",
  "requested",
  "generating",
  "done",
  "failed",
]);

// ── scenario ───────────────────────────────────────────────────────────
export const scenario = pgTable(
  "scenario",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nameEn: text("name_en").notNull(),
    nameZh: text("name_zh"),
    description: text("description"),
    /** venue category, e.g. convenience store / coffee shop / classroom */
    venueCategory: text("venue_category"),
    /** LLM-written concept scene description (Tom-centered) */
    conceptPrompt: text("concept_prompt"),
    /** concept image on LiG */
    conceptImageUrl: text("concept_image_url"),
    conceptLigId: text("concept_lig_id"),
    /** background concept-image generation state */
    conceptStatus: modelStatus("concept_status").notNull().default("none"),
    concreteScene: text("concrete_scene"),
    arcType: arcType("arc_type"),
    source: scenarioSource("source").notNull().default("ai"),
    /** normalized unique key (lowercased name_en) for dedup */
    tagKey: text("tag_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("scenario_tag_key_uq").on(t.tagKey)],
);

// ── asset ──────────────────────────────────────────────────────────────
export const asset = pgTable(
  "asset",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** origin scenario (reuse across scenarios is via tags, not this FK) */
    scenarioId: uuid("scenario_id").references(() => scenario.id, {
      onDelete: "set null",
    }),
    type: assetType("type").notNull(),
    nameEn: text("name_en").notNull(),
    nameZh: text("name_zh"),
    /** keyword.example sentence (aligns with教案 keyword structure) */
    exampleSentence: text("example_sentence"),
    semanticClass: semanticClass("semantic_class").notNull().default("concrete"),
    /** curated per-keyword image prompt (LLM); null → fall back to template */
    imagePrompt: text("image_prompt"),
    /** whether this concrete noun is suitable for image-to-3D (M2) */
    model3dEligible: boolean("model_3d_eligible").notNull().default(true),

    /** primary normalized tag for matching/dedup, e.g. toTag(name_en) */
    tagKey: text("tag_key").notNull(),
    tags: text("tags").array().notNull().default([]),
    aliases: text("aliases").array().notNull().default([]),

    /** LiG public URLs (file_url from get_asset) */
    imageUrl: text("image_url"),
    modelUrl: text("model_url"),
    thumbnailUrl: text("thumbnail_url"),
    /** LiG asset ids + ComfyUI task id (traceability) */
    ligImageId: text("lig_image_id"),
    ligModelId: text("lig_model_id"),
    comfyTaskId: text("comfy_task_id"),

    status: assetStatus("status").notNull().default("pending"),
    /** image-to-3D state; user decides per asset */
    modelStatus: modelStatus("model_status").notNull().default("none"),
    /** Tripo task id while a 3D job is in flight (async state machine) */
    modelTaskId: text("model_task_id"),
    /** side view (for multiview 3D) generated & stored (not on LiG) */
    hasSideView: boolean("has_side_view").notNull().default(false),
    /** background side-view generation state (own button) */
    sideViewStatus: modelStatus("side_view_status").notNull().default("none"),
    /** why side-view generation failed, if it did (surfaced in UI) */
    sideViewError: text("side_view_error"),

    /** captured metrics */
    imageWidth: integer("image_width"),
    imageHeight: integer("image_height"),
    imageBytes: integer("image_bytes"),
    modelFaces: integer("model_faces"),
    modelBytes: integer("model_bytes"),
    /** image_model, prompt, seed, negative_prompt, etc. */
    generationMeta: jsonb("generation_meta"),
    error: text("error"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("asset_type_tag_key_uq").on(t.type, t.tagKey),
    index("asset_tags_gin").using("gin", t.tags),
    index("asset_status_idx").on(t.status),
    index("asset_scenario_idx").on(t.scenarioId),
  ],
);

// ── generation_job ─────────────────────────────────────────────────────
export const generationJob = pgTable(
  "generation_job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    stage: jobStage("stage").notNull(),
    status: jobStatus("status").notNull().default("pending"),
    provider: text("provider"), // comfy | lig | dify
    request: jsonb("request"),
    result: jsonb("result"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("job_asset_idx").on(t.assetId)],
);

// ── side_view (multiview 3D inputs; stored in DB, NOT uploaded to LiG) ────
// One row per auxiliary view of an asset. kind: 'left' (側) | 'back' (背).
export const sideView = pgTable(
  "side_view",
  {
    assetId: uuid("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // 'left' | 'back'
    b64: text("b64").notNull(), // base64 PNG
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.kind] })],
);

// ── app_setting (single-row config for the settings center) ─────────────
export const appSetting = pgTable("app_setting", {
  id: integer("id").primaryKey().default(1),
  config: jsonb("config").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Scenario = typeof scenario.$inferSelect;
export type NewScenario = typeof scenario.$inferInsert;
export type AppSetting = typeof appSetting.$inferSelect;
export type Asset = typeof asset.$inferSelect;
export type NewAsset = typeof asset.$inferInsert;
export type GenerationJob = typeof generationJob.$inferSelect;
export type NewGenerationJob = typeof generationJob.$inferInsert;

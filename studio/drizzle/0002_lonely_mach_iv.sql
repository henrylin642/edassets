CREATE TYPE "public"."model_status" AS ENUM('none', 'requested', 'generating', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "app_setting" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "model_status" "model_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "scenario" ADD COLUMN "venue_category" text;--> statement-breakpoint
ALTER TABLE "scenario" ADD COLUMN "concept_prompt" text;--> statement-breakpoint
ALTER TABLE "scenario" ADD COLUMN "concept_image_url" text;--> statement-breakpoint
ALTER TABLE "scenario" ADD COLUMN "concept_lig_id" text;
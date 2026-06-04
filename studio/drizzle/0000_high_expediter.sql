CREATE TYPE "public"."arc_type" AS ENUM('ATTRIBUTE', 'SITUATION', 'BEHAVIOR');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('pending', 'generating', 'review', 'uploaded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."asset_type" AS ENUM('scene_object', 'keyword');--> statement-breakpoint
CREATE TYPE "public"."job_stage" AS ENUM('image', 'model', 'upload');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scenario_source" AS ENUM('ai', 'manual');--> statement-breakpoint
CREATE TYPE "public"."semantic_class" AS ENUM('concrete', 'abstract');--> statement-breakpoint
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid,
	"type" "asset_type" NOT NULL,
	"name_en" text NOT NULL,
	"name_zh" text,
	"example_sentence" text,
	"semantic_class" "semantic_class" DEFAULT 'concrete' NOT NULL,
	"tag_key" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"image_url" text,
	"model_url" text,
	"thumbnail_url" text,
	"lig_image_id" text,
	"lig_model_id" text,
	"comfy_task_id" text,
	"status" "asset_status" DEFAULT 'pending' NOT NULL,
	"generation_meta" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_type_tag_key_uq" UNIQUE("type","tag_key")
);
--> statement-breakpoint
CREATE TABLE "generation_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"stage" "job_stage" NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"provider" text,
	"request" jsonb,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_en" text NOT NULL,
	"name_zh" text,
	"description" text,
	"concrete_scene" text,
	"arc_type" "arc_type",
	"source" "scenario_source" DEFAULT 'ai' NOT NULL,
	"tag_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenario_tag_key_uq" UNIQUE("tag_key")
);
--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_scenario_id_scenario_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenario"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_tags_gin" ON "asset" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "asset_status_idx" ON "asset" USING btree ("status");--> statement-breakpoint
CREATE INDEX "asset_scenario_idx" ON "asset" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX "job_asset_idx" ON "generation_job" USING btree ("asset_id");
-- side_view reworked to support multiple auxiliary views per asset (left/back):
-- the primary key becomes (asset_id, kind).
--
-- This originally did an unconditional DROP + CREATE, which is unsafe to re-run.
-- The cloud database was brought up to date with `drizzle-kit push`, which does
-- not write migration bookkeeping, so this file can still be pending against a
-- database that ALREADY has the new shape — an unconditional DROP would then
-- destroy stored side views for no reason.
--
-- So: drop only when the table is still in the OLD shape (no "kind" column),
-- then create if absent. Correct from a fresh database and from a pushed one.
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'side_view'
	) AND NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'side_view' AND column_name = 'kind'
	) THEN
		DROP TABLE "side_view" CASCADE;
	END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "side_view" (
	"asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"b64" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "side_view_asset_id_kind_pk" PRIMARY KEY("asset_id","kind")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "side_view" ADD CONSTRAINT "side_view_asset_id_asset_id_fk"
		FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;

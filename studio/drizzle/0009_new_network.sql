-- side_view reworked to support multiple auxiliary views per asset (left/back).
-- Table holds no durable data (regenerated on demand), so drop & recreate.
DROP TABLE IF EXISTS "side_view" CASCADE;
--> statement-breakpoint
CREATE TABLE "side_view" (
	"asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"b64" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "side_view_asset_id_kind_pk" PRIMARY KEY("asset_id","kind")
);
--> statement-breakpoint
ALTER TABLE "side_view" ADD CONSTRAINT "side_view_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;

CREATE TABLE "side_view" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"b64" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "has_side_view" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "side_view_error" text;--> statement-breakpoint
ALTER TABLE "side_view" ADD CONSTRAINT "side_view_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;
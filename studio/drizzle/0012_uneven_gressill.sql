CREATE TABLE "scene_asset" (
	"scenario_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scene_asset_scenario_id_asset_id_pk" PRIMARY KEY("scenario_id","asset_id")
);
--> statement-breakpoint
ALTER TABLE "scene_asset" ADD CONSTRAINT "scene_asset_scenario_id_scenario_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_asset" ADD CONSTRAINT "scene_asset_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scene_asset_scene_idx" ON "scene_asset" USING btree ("scenario_id");
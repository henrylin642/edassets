ALTER TABLE "asset" ADD COLUMN "image_prompt" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "model_3d_eligible" boolean DEFAULT true NOT NULL;
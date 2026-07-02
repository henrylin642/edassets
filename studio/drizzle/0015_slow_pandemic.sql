ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "rec_face_limit" integer;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "rec_texture_size" integer;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "model_3d_tier" text;

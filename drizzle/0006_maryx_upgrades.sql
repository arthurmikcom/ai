ALTER TABLE "message" ADD COLUMN "suggestions" jsonb;--> statement-breakpoint
ALTER TABLE "user_pref" ADD COLUMN "about" text;--> statement-breakpoint
ALTER TABLE "user_pref" ADD COLUMN "style" text;
ALTER TABLE "ai_cost" ADD COLUMN "pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "charge_id" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "charge_day" text;
CREATE TABLE "character" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"photos" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "character_id" text;--> statement-breakpoint
ALTER TABLE "character" ADD CONSTRAINT "character_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_user_idx" ON "character" USING btree ("user_id","created_at");
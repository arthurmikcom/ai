CREATE TABLE "ai_cost" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"at" timestamp DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" double precision NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"paid_by" text NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_balance" (
	"user_id" text PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"credits" integer NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_key" (
	"user_id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"hint" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "paid_by" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "held_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment" ADD COLUMN "credits" integer;--> statement-breakpoint
ALTER TABLE "promo_code" ADD COLUMN "credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_cost" ADD CONSTRAINT "ai_cost_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_balance" ADD CONSTRAINT "credit_balance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grant" ADD CONSTRAINT "credit_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_key" ADD CONSTRAINT "user_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_cost_at_idx" ON "ai_cost" USING btree ("at");--> statement-breakpoint
CREATE INDEX "ai_cost_user_idx" ON "ai_cost" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "credit_grant_user_idx" ON "credit_grant" USING btree ("user_id","created_at");
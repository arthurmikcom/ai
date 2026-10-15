-- The platform's own AI was renamed from Nexus to MARYX.
UPDATE "chat" SET "provider" = 'maryx', "model" = 'maryx' WHERE "provider" = 'nexus';--> statement-breakpoint
UPDATE "message" SET "provider" = 'maryx' WHERE "provider" = 'nexus';--> statement-breakpoint
UPDATE "message" SET "via" = 'maryx' WHERE "via" = 'nexus';--> statement-breakpoint
UPDATE "assistant" SET "provider" = 'maryx', "model" = 'maryx' WHERE "provider" = 'nexus';

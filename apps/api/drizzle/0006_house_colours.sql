-- The school's house colours. Houses whose colour was already set in the portal are left alone.
UPDATE "houses" SET "colour" = '#1e8e3e' WHERE "name" = 'Gye Nyame' AND "colour" IS NULL;--> statement-breakpoint
UPDATE "houses" SET "colour" = '#c8102e' WHERE "name" = 'Asokore' AND "colour" IS NULL;--> statement-breakpoint
UPDATE "houses" SET "colour" = '#1f5fbf' WHERE "name" = 'Agyei Sarfo' AND "colour" IS NULL;--> statement-breakpoint
UPDATE "houses" SET "colour" = '#f2c200' WHERE "name" = 'Kuma Korante' AND "colour" IS NULL;

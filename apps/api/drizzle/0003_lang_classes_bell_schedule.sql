ALTER TABLE "programmes" ADD COLUMN "spaced_name" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "school_profile" ADD COLUMN "bell_schedule" jsonb;--> statement-breakpoint
-- Languages classes are written "1 LANG 1" (option groups "1 LANG 1A", "1 LANG 2A").
UPDATE "programmes" SET "code" = 'LANG', "spaced_name" = true WHERE "code" = 'L' AND "name" = 'Languages';--> statement-breakpoint
UPDATE "classes" SET "name" = regexp_replace("name", '^(\d)L (\d+)$', '\1 LANG \2')
  WHERE "programme_id" IN (SELECT "id" FROM "programmes" WHERE "name" = 'Languages') AND "name" ~ '^\dL \d+$';

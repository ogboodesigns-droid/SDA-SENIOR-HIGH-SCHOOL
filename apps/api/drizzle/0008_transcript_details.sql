ALTER TABLE "school_profile" ADD COLUMN "gps_address" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "assessment_ref_id" text;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_assessment_ref_id_unique" UNIQUE("assessment_ref_id");--> statement-breakpoint
-- The school's contact details as printed on its official transcript, where none were entered yet.
UPDATE "school_profile" SET "phone" = '0208188483' WHERE "id" = 1 AND "phone" IS NULL;--> statement-breakpoint
UPDATE "school_profile" SET "email" = 'sdaseniorhigh.ask@gmail.com' WHERE "id" = 1 AND "email" IS NULL;--> statement-breakpoint
UPDATE "school_profile" SET "gps_address" = 'EN-135-1605' WHERE "id" = 1;

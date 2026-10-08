CREATE TABLE "guardian_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"occupation" text,
	"alt_phone" text
);
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "bece_index_no" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "surname" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "other_names" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ghana_card_no" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "hometown" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "home_region" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "religion" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "jhs_attended" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "residential_status" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "admission_date" date;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "residential_address" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "gps_address" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "emergency_contact" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "medical_notes" text;--> statement-breakpoint
ALTER TABLE "guardian_profiles" ADD CONSTRAINT "guardian_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_bece_index_no_unique" UNIQUE("bece_index_no");
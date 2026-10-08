ALTER TYPE "public"."audience_type" ADD VALUE 'house';--> statement-breakpoint
CREATE TABLE "combination_subjects" (
	"combination_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	CONSTRAINT "combination_subjects_combination_id_subject_id_pk" PRIMARY KEY("combination_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "house_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"house_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"awarded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "houses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"colour" text,
	CONSTRAINT "houses_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "programme_core_exclusions" (
	"programme_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	CONSTRAINT "programme_core_exclusions_programme_id_subject_id_pk" PRIMARY KEY("programme_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "subject_combinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"programme_id" uuid NOT NULL,
	"option" smallint NOT NULL,
	"stream" smallint NOT NULL,
	"letter" text DEFAULT '' NOT NULL,
	"must_drop_one" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "scores" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "complete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "school_profile" ADD COLUMN "assessment_schemes" jsonb;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "combination_id" uuid;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "house_id" uuid;--> statement-breakpoint
ALTER TABLE "terms" ADD COLUMN "semester" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "combination_subjects" ADD CONSTRAINT "combination_subjects_combination_id_subject_combinations_id_fk" FOREIGN KEY ("combination_id") REFERENCES "public"."subject_combinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combination_subjects" ADD CONSTRAINT "combination_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "house_points" ADD CONSTRAINT "house_points_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "house_points" ADD CONSTRAINT "house_points_awarded_by_users_id_fk" FOREIGN KEY ("awarded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_core_exclusions" ADD CONSTRAINT "programme_core_exclusions_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme_core_exclusions" ADD CONSTRAINT "programme_core_exclusions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_combinations" ADD CONSTRAINT "subject_combinations_programme_id_programmes_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programmes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "house_points_house_idx" ON "house_points" USING btree ("house_id");--> statement-breakpoint
CREATE UNIQUE INDEX "combinations_programme_option" ON "subject_combinations" USING btree ("programme_id","option");--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_combination_id_subject_combinations_id_fk" FOREIGN KEY ("combination_id") REFERENCES "public"."subject_combinations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_house_id_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."houses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_semester_range" CHECK ("terms"."semester" in (1, 2));--> statement-breakpoint
-- CA/exam maximums are replaced by the semester assessment schemes.
UPDATE "school_profile" SET "grading_scale" = "grading_scale" - 'caMax' - 'examMax' WHERE "grading_scale" IS NOT NULL;--> statement-breakpoint
UPDATE "terms" SET "semester" = 2 WHERE "name" ILIKE '%second%' OR "name" ILIKE '%2nd%';--> statement-breakpoint
-- Results entered under the old CA/exam split stay as they were (no component breakdown).
UPDATE "results" SET "complete" = true;

ALTER TABLE "classes" ADD COLUMN "stream" smallint;--> statement-breakpoint
ALTER TABLE "programmes" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "programmes" ADD CONSTRAINT "programmes_code_unique" UNIQUE("code");--> statement-breakpoint
-- The school confirmed the WASSCE scale (A1 from 75%). It replaces the provisional scale everywhere.
UPDATE "school_profile" SET "grading_scale" = '{"caMax":30,"examMax":70,"bands":[{"min":75,"grade":"A1","points":1,"remark":"Excellent"},{"min":70,"grade":"B2","points":2,"remark":"Very Good"},{"min":65,"grade":"B3","points":3,"remark":"Good"},{"min":60,"grade":"C4","points":4,"remark":"Credit"},{"min":55,"grade":"C5","points":5,"remark":"Credit"},{"min":50,"grade":"C6","points":6,"remark":"Credit"},{"min":45,"grade":"D7","points":7,"remark":"Pass"},{"min":40,"grade":"E8","points":8,"remark":"Pass"},{"min":0,"grade":"F9","points":9,"remark":"Fail"}]}'::jsonb;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "grade_point" smallint;--> statement-breakpoint
-- Re-grade any results entered under the provisional scale.
UPDATE "results" SET
  "grade_point" = CASE WHEN "total" >= 75 THEN 1 WHEN "total" >= 70 THEN 2 WHEN "total" >= 65 THEN 3 WHEN "total" >= 60 THEN 4
    WHEN "total" >= 55 THEN 5 WHEN "total" >= 50 THEN 6 WHEN "total" >= 45 THEN 7 WHEN "total" >= 40 THEN 8 ELSE 9 END;--> statement-breakpoint
UPDATE "results" SET
  "grade" = (ARRAY['A1','B2','B3','C4','C5','C6','D7','E8','F9'])["grade_point"],
  "remark" = (ARRAY['Excellent','Very Good','Good','Credit','Credit','Credit','Pass','Pass','Fail'])["grade_point"];--> statement-breakpoint
ALTER TABLE "results" ALTER COLUMN "grade_point" SET NOT NULL;

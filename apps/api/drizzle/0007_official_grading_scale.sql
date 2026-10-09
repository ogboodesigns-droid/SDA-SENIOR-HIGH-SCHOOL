-- The school's official scale (as on its semester score sheet: A1 80–100 … F9 0–39) with the
-- transcript's 4.0 GPA points. Replaces the earlier default (A1 75–100) unless the school had
-- already edited the scale, and regrades every result on it.
UPDATE "school_profile"
SET "grading_scale" = '{"creditsPerSubject":10,"bands":[
  {"min":80,"grade":"A1","points":1,"gpa":4.0,"remark":"Excellent"},
  {"min":70,"grade":"B2","points":2,"gpa":3.5,"remark":"Very Good"},
  {"min":65,"grade":"B3","points":3,"gpa":3.0,"remark":"Good"},
  {"min":60,"grade":"C4","points":4,"gpa":2.5,"remark":"Credit"},
  {"min":55,"grade":"C5","points":5,"gpa":2.0,"remark":"Credit"},
  {"min":50,"grade":"C6","points":6,"gpa":1.5,"remark":"Credit"},
  {"min":45,"grade":"D7","points":7,"gpa":1.0,"remark":"Pass"},
  {"min":40,"grade":"E8","points":8,"gpa":0.5,"remark":"Pass"},
  {"min":0,"grade":"F9","points":9,"gpa":0.0,"remark":"Fail"}]}'::jsonb
WHERE "grading_scale" IS NULL
   OR "grading_scale" -> 'bands' @> '[{"grade":"A1","min":75}]'::jsonb;--> statement-breakpoint
UPDATE "results" r
SET ("grade", "grade_point", "remark") = (
  SELECT e ->> 'grade', (e ->> 'points')::smallint, e ->> 'remark'
  FROM "school_profile" p, jsonb_array_elements(p."grading_scale" -> 'bands') e
  WHERE p."id" = 1 AND (e ->> 'min')::numeric <= r."total"
  ORDER BY (e ->> 'min')::numeric DESC
  LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM "school_profile" p WHERE p."id" = 1 AND p."grading_scale" -> 'bands' @> '[{"grade":"A1","min":80}]'::jsonb);

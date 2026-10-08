# Architecture

```text
 Phones (students, parents, teachers)          Browsers (staff)
        │  Expo / React Native app                     │  Next.js portal
        │  tokens in Android Keystore / iOS Keychain   │  tokens in httpOnly cookies
        │                                              │  (server-side proxy: /api/proxy/*)
        └──────────────── HTTPS, JSON ─────────────────┘
                              │
                      NestJS API  /api/v1
                  ┌───────────┼──────────────┐
             PostgreSQL   File storage    Expo push service
            (Drizzle ORM) (disk or S3)
```

## Packages

- **`packages/shared`**: the single source of truth for roles, permissions, Zod validation schemas and JSON wire types. The API validates every request body with these schemas; the portal and app use the same types, so a field rename breaks the build instead of production.
- **`apps/api`**: NestJS 11 (CommonJS). One module per feature (`auth`, `users`, `school`, `academics`, `timetable`, `announcements`, `events`, `assignments`, `results`, `notifications`, `files`). The database schema lives in `src/database/schema.ts`; migrations are generated into `apps/api/drizzle/` with `pnpm db:generate` and applied with `pnpm db:migrate` (the Docker image applies them on start).
- **`apps/web-admin`**: Next.js 16 App Router. Pages are client components that call `/api/proxy/...`, a route handler that attaches the access token from an httpOnly cookie, refreshes it when it expires and forwards to the API. Page scripts never see a token.
- **`apps/mobile`**: Expo SDK 57 with Expo Router (`src/app`). `src/lib/api.ts` holds the token logic (one refresh in flight at a time), `src/lib/auth.tsx` the session and the parent's selected child, and `src/lib/useQuery.ts` refetches on screen focus and supports pull-to-refresh.

## Request lifecycle

1. `ThrottlerGuard` rate-limits by IP (300/min generally, 10/min for sign-in).
2. `AuthGuard` verifies the JWT, then re-reads the user and session from the database, so deactivating an account or signing out a device takes effect immediately. It blocks everything except password change while a temporary password is in use, and checks route permissions (`@RequirePermissions`).
3. `ZodPipe` validates and normalises the body or query against the shared schema.
4. The service applies **record-level** rules through `AccessService` (see SECURITY.md).
5. `AllExceptionsFilter` maps database constraint errors to 400/409 and hides internal errors.

## Key design decisions

- **One primary role per account.** Responsibilities such as "form master of 2 Science A" or "teaches Core Maths in 1 Arts B" come from data (`classes.form_master_id`, `class_subjects.teacher_id`), not extra roles, so reassigning a teacher needs no permission changes.
- **Audience targeting** (`school` / `role` / `form` / `programme` / `class`) is shared by announcements and events, and is evaluated in SQL so feeds stay fast.
- **Results are frozen once published.** Teachers can no longer change them; leadership can correct them, and the correction is audited separately.
- **Grading follows the WASSCE scale** (A1 75–100 = 1 … F9 0–39 = 9). It is stored with the school profile and editable in the portal; each result stores its grade point so term aggregates (best 3 core + best 3 electives) can be computed.
- **Class names** follow the subject combination list: `<form><code> <class no.>` (e.g. `1BUS 2`, `2G/A 3`). Programmes (learning areas) carry the code; `classes.stream` keeps classes in numeric order. `POST /classes/bulk` creates a learning area's classes for chosen forms, skips existing ones and fills each class's subjects from its options.
- **Options (subject combinations)** belong to a learning area and a class number, with a letter for the group inside the class (`1BUS 2A`, `1BUS 2B`). A student's subjects are the core subjects their learning area offers (`programme_core_exclusions` removes General Science for Science) plus their option's electives — see `CurriculumService`. Mark sheets, assignments (and their notifications), timetables and the student's subject list all go through it. Electives taken by different groups of the same class may share a timetable period ("split"); core subjects never do. A teacher with the same subject at the same time in several classes is a **combined lesson**: it is worked out from the timetable and teacher assignments (no extra data), shown as "combined with …" and as one period in the teacher's own week. A teacher with *different* subjects at the same time, or an option taking both halves of a split, produces a warning rather than a refusal so the timetable office stays in control.
- **The school day** (`bell_schedule`: periods, breaks, school-wide activities such as Friday PLC / VLC) is stored with the school profile; lessons can't be placed during an activity.
- **Assessment** is a per-semester list of weighted components stored with the school profile (15/15/10/20/40 by default). Results store a mark per component (`results.scores`), plus derived CA, exam, total, grade and `complete`; marks can be entered piecemeal and only complete results are publishable. Terms carry `semester` (1 or 2), which picks the scheme.
- **The school catalogue** (`school-catalogue.ts`) is loaded by bootstrap and is idempotent; edits made in the portal are never overwritten.
- **Low bandwidth.** The app keeps previous data on screen while refetching, uses 20-second timeouts with friendly messages, and pages are plain lists without heavy images or animation.
- **Scheduled announcements** are dispatched by a once-a-minute job in the API. Each row is claimed with an `UPDATE … RETURNING`, so several API instances never notify twice.

## Adding a feature module

1. Add tables to `schema.ts`, then run `pnpm db:generate --name <change>` and review the SQL.
2. Add Zod schemas and wire types to `packages/shared`.
3. Create a Nest module with a controller and a service; use `@RequirePermissions` for the coarse check and `AccessService` for record-level checks.
4. Add integration tests in `apps/api/test` that cover who must *not* see the data.

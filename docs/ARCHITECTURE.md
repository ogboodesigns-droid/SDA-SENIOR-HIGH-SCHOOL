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
- **Grading scale is data**, stored with the school profile and editable in the portal. The default is the WAEC-style nine-point scale, which the school must confirm.
- **Low bandwidth.** The app keeps previous data on screen while refetching, uses 20-second timeouts with friendly messages, and pages are plain lists without heavy images or animation.
- **Scheduled announcements** are dispatched by a once-a-minute job in the API. Each row is claimed with an `UPDATE … RETURNING`, so several API instances never notify twice.

## Adding a feature module

1. Add tables to `schema.ts`, then run `pnpm db:generate --name <change>` and review the SQL.
2. Add Zod schemas and wire types to `packages/shared`.
3. Create a Nest module with a controller and a service; use `@RequirePermissions` for the coarse check and `AccessService` for record-level checks.
4. Add integration tests in `apps/api/test` that cover who must *not* see the data.

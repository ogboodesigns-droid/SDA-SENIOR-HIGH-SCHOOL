# SDA SHS — S.D.A Senior High School, Asokore-Koforidua

**Knowledge for Excellence** · P. O. Box 18, Asokore - Koforidua · Est. 2001

One connected system for the school:

| App | What it is | Who uses it |
| --- | --- | --- |
| `apps/mobile` | Android-first React Native (Expo) app, ready for iOS | Students, parents/guardians, teachers |
| `apps/web-admin` | Next.js administration portal | School leadership, administrators, teachers |
| `apps/api` | NestJS API with PostgreSQL (Drizzle ORM) | Both apps |
| `packages/shared` | Roles, permissions, validation schemas and API types | All of the above |

Students and parents use the phone app; teachers and administrators do the heavier work (entering results, building the timetable, managing accounts) on the web portal.

## What V1 includes

- **Secure accounts** for students, parents/guardians, teachers and staff, created by the school (no public sign-up). Sign in with a student number, staff number, email or phone. Temporary passwords must be changed at first sign-in.
- **Role-based access** (super admin, head, assistant head, teacher, accountant, librarian, counsellor, parent, student) plus record-level rules: students see only their own records, parents only their linked children, teachers only the classes they teach.
- **School profile**: name, motto, vision, mission, core values, history and contacts, all editable in the portal.
- **Academic structure**: academic years, terms, programmes, classes, subjects, and which teacher takes each subject in each class. Classes follow the school's naming — form, programme code, class number (1 SCI 1, 2 BUS 2, 3 GA 6) — and a whole programme's classes can be created in one step (e.g. General Arts with 6 classes per form), with single classes addable at any time.
- **Timetable** per class and term, with class and teacher clash detection; personal weekly view in the app.
- **Announcements** by category (Academic, Examination, Sports, SRC, PTA, Religious, Emergency…), targeted at the whole school, a role, a form, a programme or a class, with scheduling, expiry, priority and optional push notifications.
- **School calendar** of events, also audience-targeted.
- **Assignments**: teachers set work; students submit text and/or a PDF, Word document or photo; teachers mark with feedback; late submissions are flagged.
- **Results**: CA + exam entry per class and subject, grades computed on the **WASSCE scale** (A1 75–100 … F9 0–39, grade points 1–9) with a term average and aggregate (best 3 core + best 3 electives), kept private until leadership publishes them, then visible to the student and their parents.
- **Notifications**: in-app inbox plus Expo push notifications for new assignments, marked work, published results and announcements.
- **Faith & Spiritual Life** section built from the school's religious announcements and programmes.
- **Read aloud** for announcements (text-to-speech).
- **Audit log** of sign-ins, account changes, result entry and publishing, and other data changes.

No sample students, staff, school history or payment details are included. Everything is entered by the school.

See [docs/ROADMAP.md](docs/ROADMAP.md) for V2 and V3, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together, and [docs/SECURITY.md](docs/SECURITY.md) for how student data is protected.

## Running it locally

Requirements: Node.js 20.19+ (22 recommended), pnpm 10, PostgreSQL 16.

```bash
pnpm install
cp .env.example .env            # then fill in JWT_ACCESS_SECRET and DATABASE_URL
set -a; . ./.env; set +a

pnpm build:shared
pnpm --filter @sda-shs/api build
pnpm db:migrate

# First-time setup: the school's official name and the first super administrator
# (the school's name, motto and address are filled in automatically)
ADMIN_NAME="Your Name" ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="a-strong-password-1" pnpm db:bootstrap

pnpm dev:api        # http://localhost:4000
pnpm dev:admin      # http://localhost:3000
pnpm dev:mobile     # Expo; set EXPO_PUBLIC_API_URL in apps/mobile/.env first
```

Then sign in to the portal at http://localhost:3000 and follow the "Getting started" steps on the dashboard.

### With Docker

```bash
cp .env.example .env    # set POSTGRES_PASSWORD and JWT_ACCESS_SECRET
docker compose up -d --build
docker compose exec api sh -c 'ADMIN_NAME="..." ADMIN_EMAIL="..." ADMIN_PASSWORD="..." node dist/database/bootstrap.js'
```

### Mobile app

See [apps/mobile/README.md](apps/mobile/README.md) for running on an Android phone, enabling push notifications and building an APK/AAB.

## Checks

```bash
pnpm typecheck   # all packages
pnpm test        # shared unit tests + API integration tests (needs PostgreSQL)
```

The API tests create and drop tables in the database named by `TEST_DATABASE_URL` (default `postgres://sda_shs:sda_shs@localhost:5432/sda_shs_test`). Never point it at a real database.

## Project layout

```text
apps/
  api/          NestJS API, Drizzle schema and migrations, integration tests
  mobile/       Expo Router app (src/app = screens)
  web-admin/    Next.js portal (src/app/(portal) = pages)
packages/
  shared/       roles, permissions, Zod schemas, wire types, grading
docker/         Dockerfiles for the API and portal
docs/           architecture, security and roadmap
```

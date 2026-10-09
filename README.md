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
- **Academic structure** loaded from the school's *2026/2027 Subject Combination* lists: the five core subjects, 24 electives and the six learning areas (General Science, General Arts, Visual Arts, Business, Home Economics, Languages) with every option. Setup creates every class for SHS 1–3 with the official codes — Arts 1–4 (1G/A 1…), Bus 1–2 (1BUS 1…), H/Econs 1–3 (1H/E 1…), Lang 1–2 (1 LANG 1…), Science 1 (1G/S 1) and Visual 1–2 (1VIS 1…) — each pre-filled with the subjects its options need; more classes can be added at any time. Each student is placed in an option (e.g. 1BUS 1B), which decides their electives, assignments, timetable and mark sheets; Science students don't take General Science. Where the timetable runs two of an option's electives at the same time (Science Option 7: Geography / Computing; Home Economics Option 6: Art & Design Foundation / French), or a * option reaches SHS 3, the office records the subject each student drops; the dashboard lists students still to choose, and dropped subjects disappear from that student's subjects, timetable, assignments and mark sheets. Two semesters per academic year.
- **Houses**: Gye Nyame (green), Asokore (red), Agyei Sarfo (blue) and Kuma Korante (yellow), shown in their colours, with students assigned, a points table kept by leadership, and house-targeted notices.
- **Timetable** laid out like the school's master timetables: Breakfast, P1–P4, Lunch, P5–P8, Friday PLC / VLC and early close (all editable), split periods for option groups (GEOGRAPHY / COMPUTING), periods-per-week counts, **combined lessons** (the same teacher taking the same subject with several classes at once, e.g. French for 1SC and 1HE2, shown as one lesson), and warnings when an option or teacher would really be double-booked. Students see only their own option's lessons. The provisional 2026/27 1SC and 1HE2 timetables can be loaded with `pnpm --filter @sda-shs/api db:sample-timetables`.
- **Announcements** by category (Academic, Examination, Sports, SRC, PTA, Religious, Emergency…), targeted at the whole school, a role, a form, a programme or a class, with scheduling, expiry, priority and optional push notifications.
- **School calendar** of events, also audience-targeted.
- **Assignments**: teachers set work; students submit text and/or a PDF, Word document or photo; teachers mark with feedback; late submissions are flagged.
- **Results**: marks entered per assessment mode — Individual Class Assessments 15, Mid-Semester 15, Practical/Portfolio 10, Group (Sem 1) or Individual (Sem 2) Projects 20, Supervised Semester Assessment 40 — through the semester; graded on the **WASSCE scale** (A1 75–100 … F9 0–39, grade points 1–9) with an average and aggregate (best 3 core + best 3 electives), kept private until leadership publishes them (only results with every mark entered can be published), then visible to the student and their parents.
- **Bulk import** from the school's own spreadsheets:
  - *Students*: the *SDA SHS Student Registration Import* sheet (BECE index no., admission no., names, gender, date of birth, Ghana Card, hometown, JHS, class and option such as 1BUS 1A or 1 LANG 1A, house, residential status, guardian details…). The upload is checked first and every problem is listed by row; nothing is saved until the office presses Import. Admission numbers are written `SDA/YY/NNNN` (e.g. SDA/25/0142); blank ones get the next number for the admission year. Parent/guardian accounts are created from the guardian phone number, and siblings share one parent account. Sign-in slips with one-time temporary passwords can be printed or saved as CSV.
  - *Marks*: teachers download a class score sheet in the school's *Grade Import* layout (register, assessment columns, totals and grades as Excel formulas), fill it in and upload it. Blank marks are left as they are, existing marks are only replaced when asked, and published marks can only be changed by leadership.
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
# (fills in the school's name, motto and address, and loads subjects, learning areas, options and houses)
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

apps/api/src/database/school-catalogue.ts   the school's subjects, options and houses (re-run safely with pnpm --filter @sda-shs/api db:catalogue)
```

# Roadmap

The product specification is split into three releases. V1 is built in this repository; V2 and V3 are planned and the architecture is ready for them.

## V1 — Foundation ✅

| Spec section | Status | Notes |
| --- | --- | --- |
| Authentication, student/teacher/parent accounts, profiles | ✅ | Admin-issued accounts, forced password change, device sessions |
| Role-based security (§30) | ✅ | 9 roles + record-level access; form master derived from class data |
| Home screen (§3) | ✅ | Greeting, notification count, today's lessons, quick access, due work, upcoming events, latest news |
| Bottom navigation (§4) | ✅ | Home · Academics · Updates · Calendar · Profile |
| School profile (§5) | ✅ | Fully editable, nothing invented |
| News & announcements (§6) | ✅ | 12 categories, targeting, scheduling, expiry, priority, push |
| Timetable (§7) | ✅ | Per class/term, clash detection, personal view |
| Student academic portal (§8) | ✅ | Subjects with teachers |
| Assignments (§9) | ✅ | Text and file submissions, late flag, marking with feedback |
| Results (§10) | ✅ | CA/exam/total/grade/remark/comment, publish workflow, term average. *Class position* is not computed until the school confirms its policy |
| School calendar (§16) | ✅ | Audience-targeted events |
| Push notifications (§28) | ✅ | Expo push; targeted by school, role, form, programme, class, student and guardians |
| Admin dashboard (§29) | ✅ (V1 scope) | People, classes & subjects, timetable, announcements, calendar, assignments, results, school profile, audit log |
| Faith & Spiritual Life (§25) | ✅ (basic) | Built from religious announcements and events; a dedicated editable programme structure comes in V2 |
| Text-to-speech (§27) | ✅ (basic) | "Read aloud" on announcements |
| Data protection (§35) | ✅ | See SECURITY.md |

## V2 — School management

- **Attendance (§11):** teacher registers per lesson or day (Present/Absent/Late/Excused), percentages for students and parents, an "absent today" push to guardians.
- **Fees (§12):** read-only statements (amount, paid, balance, status) entered by the accountant. **Payment processing (Mobile Money, bank, gateway) is not built until the school supplies its official provider and account details.**
- **Learning materials (§13):** uploads by form → programme → subject → topic, reusing the files module and adding video/audio size limits.
- **Digital library (§14):** catalogue and e-resources with search; librarian role.
- **Examination centre (§15):** exam timetables, instructions, mock exams, WASSCE notices.
- **Houses (§17), clubs & societies (§23), sports (§24):** configurable by the school; house points and leaderboard.
- **Guidance & counselling (§21):** confidential appointment requests visible only to counsellors; separate audit stream.
- **Health / sick bay (§22):** notices and appointment requests; medical records only for authorised health staff, with field-level encryption.
- **Parent portal extras (§20):** absence alerts, fees, teacher comments.
- **Communication channels (§19):** moderated, one-way-by-default channels (class, house, department, club, SRC) following safeguarding policy; no unsolicited private student–teacher messaging.
- **Infrastructure:** Redis for distributed rate limiting, job queues (push fan-out, scheduled announcements) and WebSocket fan-out; staff 2FA; CSV bulk import of students and guardians.

## V3 — Advanced

- **Digital student ID with QR (§18)** for attendance, library and events (signed, rotating QR payloads).
- **Speech-to-text (§26):** dictation for responses, search and messages. English first; Twi, Ga, Ewe and Fante only after the chosen speech provider has been tested on each language with Ghanaian speakers.
- **Offline mode:** cached timetable, results, announcements and materials with background sync.
- **AI study assistant (§34):** explanations, practice questions, flashcards and study plans, positioned as a study aid. Needs guardrails for minors, teacher visibility and a clear privacy notice before launch.
- **Advanced analytics:** performance trends by class/subject, attendance patterns, early-warning indicators for leadership.

## Information the school needs to provide

- Official school name, logo, motto, vision, mission, core values, history, contacts and leadership
- Confirmed grading scale and CA/exam weighting, and whether class positions are published
- Programmes, classes, subjects and teacher assignments; academic calendar
- Houses, clubs and religious programme structure (V2)
- Fees structure and official payment provider details (V2, before any payment integration)

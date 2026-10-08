# Security and data protection

The system holds records about minors: identities, results, attendance (V2) and potentially health information (V2). Security is part of the core design.

## Accounts and sign-in

- **No self sign-up.** The school creates every account with a temporary password, which must be changed at first sign-in (enforced by the API, not just the UI).
- Passwords are hashed with **Argon2id**. Policy: at least 10 characters with at least one letter and one number.
- **Lockout:** 5 failed attempts lock the account for 15 minutes; sign-in is also rate-limited to 10 requests per minute per IP.
- Unknown accounts and wrong passwords get the same message and take the same time, so valid identifiers can't be discovered.
- **Access tokens** are HS256 JWTs valid for 15 minutes. **Refresh tokens** are random 256-bit values stored only as SHA-256 hashes, rotated on every use, and expire after 30 days of inactivity. Replaying an already-used refresh token (outside a 30-second race window) revokes that device's session.
- Every request re-checks that the account is active and the session hasn't been revoked. Deactivating an account, resetting a password or signing out a device takes effect immediately.
- Changing a password signs out all other devices. Users can see and sign out their devices from the app.
- The admin portal stores tokens in `httpOnly`, `Secure`, `SameSite=Strict` cookies and rejects cross-origin state-changing requests. Students and parents cannot sign in to the portal.
- The mobile app stores tokens in the Android Keystore / iOS Keychain (`expo-secure-store`, this-device-only).

## Who can see what

Route permissions (`packages/shared/src/permissions.ts`) control *what kind* of action a role may take. `apps/api/src/access/access.service.ts` controls *which records*:

| Role | Student records visible |
| --- | --- |
| Student | Only their own |
| Parent/guardian | Only children the school has linked to them |
| Teacher | Students in classes where they teach a subject or are form master |
| Head, assistant head, super admin | Whole school |
| Accountant, librarian, counsellor | None in V1 (their modules come in V2 with their own rules) |

Other rules:

- Results stay hidden from students and parents until leadership publishes them. Teachers cannot publish or change published results.
- Teachers can post announcements only to classes they teach; school-wide, urgent and role-targeted messages need leadership.
- Students and parents cannot list classmates.
- Requests for records the user may not see return **404**, not 403, so record ids can't be probed.
- Only a super administrator can create or change another super administrator.

These rules are covered by integration tests in `apps/api/test/access.spec.ts` and `auth.spec.ts`.

## Files

- Uploads are limited to 10 MB and to PDF, Word, JPEG and PNG, checked by **file signature**, not by the name or declared type.
- Files are stored under random server-generated keys (disk or S3-compatible storage). They are served only to the uploader, the teacher of the relevant class, the student's linked parents and leadership, with `Content-Disposition: attachment`, `nosniff` and `no-store`.

## Audit trail

`audit_logs` records sign-ins, failed sign-ins and lockouts, refresh-token reuse, password changes and resets, account creation, updates and deactivation, guardian links, announcement, event and assignment changes, marking, result entry, publishing and post-publication corrections, and school profile and grading changes. Leadership can view it in the portal.

## Deployment checklist

- [ ] Serve the API and portal only over **HTTPS** (TLS at the reverse proxy); set `TRUST_PROXY_HOPS` so IP-based limits and logs use the real client address.
- [ ] Generate `JWT_ACCESS_SECRET` with `openssl rand -base64 48` and keep it out of git.
- [ ] Use a strong `POSTGRES_PASSWORD`; don't expose PostgreSQL to the internet.
- [ ] Enable encrypted, automated **database backups** (and storage-bucket backups) and test a restore.
- [ ] Enable encryption at rest on the database volume and object storage.
- [ ] Set `CORS_ORIGINS` to the real portal origin only.
- [ ] Confirm the grading scale and school profile with the school before going live.
- [ ] Agree a **data-retention policy** with the school (e.g. how long leavers' records are kept) before V2's archival tooling.
- [ ] Confirm what consent the school collects from parents/guardians, and comply with Ghana's Data Protection Act, 2012 (Act 843), including registration with the Data Protection Commission where required.

## Known V1 limitations

- No email/SMS verification or 2FA yet; accounts are issued by the school. 2FA for staff is planned for V2.
- Rate limiting is per API instance (in memory). With several instances behind a load balancer, move it to Redis (planned with V2's queues).
- Push notification content is visible on the lock screen. Notifications never include marks or other sensitive detail, only "results published" style messages.

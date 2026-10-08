import { Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import type { AudienceType, NotificationType, Role } from '@sda-shs/shared';
import { config } from '../config';
import { InjectDb, type Database } from '../database/database.module';
import { classes, classSubjects, guardianStudents, notifications, pushTokens, students, users } from '../database/schema';

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH = 100;
const INSERT_BATCH = 1000;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(@InjectDb() private readonly db: Database) {}

  /** Active users an audience-targeted announcement or event is addressed to. */
  async audienceUserIds(type: AudienceType, ref: string | null): Promise<string[]> {
    const active = eq(users.status, 'active');
    if (type === 'school') {
      return (await this.db.select({ id: users.id }).from(users).where(active)).map((r) => r.id);
    }
    if (type === 'role') {
      return (await this.db.select({ id: users.id }).from(users).where(and(active, eq(users.role, ref as Role)))).map((r) => r.id);
    }
    if (type === 'house') {
      const rows = await this.db.select({ id: students.id }).from(students).where(eq(students.houseId, ref!));
      return this.studentAndGuardianUserIds(rows.map((r) => r.id));
    }
    let classCond: SQL;
    if (type === 'class') classCond = eq(classes.id, ref!);
    else if (type === 'form') classCond = eq(classes.form, Number(ref));
    else classCond = eq(classes.programmeId, ref!);

    const classIds = (await this.db.select({ id: classes.id }).from(classes).where(classCond)).map((r) => r.id);
    return this.classAudienceUserIds(classIds);
  }

  /** Students in the classes, their guardians, and the classes' teachers. */
  async classAudienceUserIds(classIds: string[], opts: { includeTeachers?: boolean } = { includeTeachers: true }): Promise<string[]> {
    if (!classIds.length) return [];
    const ids = new Set<string>();
    const studentRows = await this.db
      .select({ userId: students.userId, guardianId: guardianStudents.guardianUserId })
      .from(students)
      .leftJoin(guardianStudents, eq(guardianStudents.studentId, students.id))
      .where(inArray(students.classId, classIds));
    for (const r of studentRows) {
      ids.add(r.userId);
      if (r.guardianId) ids.add(r.guardianId);
    }
    if (opts.includeTeachers) {
      const teacherRows = await this.db
        .selectDistinct({ teacherId: classSubjects.teacherId, formMasterId: classes.formMasterId })
        .from(classes)
        .leftJoin(classSubjects, eq(classSubjects.classId, classes.id))
        .where(inArray(classes.id, classIds));
      for (const r of teacherRows) {
        if (r.teacherId) ids.add(r.teacherId);
        if (r.formMasterId) ids.add(r.formMasterId);
      }
    }
    return this.onlyActive([...ids]);
  }

  /** A student plus their linked guardians. */
  async studentAndGuardianUserIds(studentIds: string[]): Promise<string[]> {
    if (!studentIds.length) return [];
    const rows = await this.db
      .select({ userId: students.userId, guardianId: guardianStudents.guardianUserId })
      .from(students)
      .leftJoin(guardianStudents, eq(guardianStudents.studentId, students.id))
      .where(inArray(students.id, studentIds));
    return this.onlyActive([...new Set(rows.flatMap((r) => (r.guardianId ? [r.userId, r.guardianId] : [r.userId])))]);
  }

  private async onlyActive(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.db.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), eq(users.status, 'active')));
    return rows.map((r) => r.id);
  }

  /** Stores an in-app notification for each user and, if asked, sends a push. */
  async notify(userIds: string[], payload: NotificationPayload, opts: { push: boolean }): Promise<void> {
    const unique = [...new Set(userIds)];
    if (!unique.length) return;
    for (let i = 0; i < unique.length; i += INSERT_BATCH) {
      await this.db.insert(notifications).values(
        unique.slice(i, i + INSERT_BATCH).map((userId) => ({
          userId,
          type: payload.type,
          title: payload.title,
          body: payload.body,
          data: payload.data ?? null,
        })),
      );
    }
    if (opts.push) {
      // Delivery happens in the background; the request that triggered it doesn't wait.
      void this.sendPush(unique, payload).catch((err) => this.logger.error(`Push delivery failed: ${String(err)}`));
    }
  }

  private async sendPush(userIds: string[], payload: NotificationPayload) {
    if (!config().EXPO_PUSH_ENABLED) return;
    const tokens: string[] = [];
    for (let i = 0; i < userIds.length; i += INSERT_BATCH) {
      const rows = await this.db
        .select({ token: pushTokens.token })
        .from(pushTokens)
        .where(inArray(pushTokens.userId, userIds.slice(i, i + INSERT_BATCH)));
      tokens.push(...rows.map((r) => r.token));
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (config().EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${config().EXPO_ACCESS_TOKEN}`;

    for (let i = 0; i < tokens.length; i += EXPO_BATCH) {
      const batch = tokens.slice(i, i + EXPO_BATCH);
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(
          batch.map((to) => ({ to, title: payload.title, body: payload.body, data: payload.data ?? {}, sound: 'default', channelId: 'default' })),
        ),
      });
      if (!res.ok) {
        this.logger.warn(`Expo push returned ${res.status}`);
        continue;
      }
      const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
      const stale = (json.data ?? [])
        .map((ticket, idx) => (ticket.details?.error === 'DeviceNotRegistered' ? batch[idx] : null))
        .filter((t): t is string => !!t);
      if (stale.length) await this.db.delete(pushTokens).where(inArray(pushTokens.token, stale));
    }
  }

  async registerPushToken(userId: string, token: string, platform: string) {
    await this.db
      .insert(pushTokens)
      .values({ userId, token, platform })
      .onConflictDoUpdate({ target: pushTokens.token, set: { userId, platform } });
  }

  async removePushToken(userId: string, token: string) {
    await this.db.delete(pushTokens).where(and(eq(pushTokens.token, token), eq(pushTokens.userId, userId)));
  }
}

import { ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { ANNOUNCEMENT_CATEGORIES, hasPermission, isLeadership, type Announcement, type AnnouncementInput } from '@sda-shs/shared';
import { config } from '../config';
import { InjectDb, type Database } from '../database/database.module';
import { announcements, users } from '../database/schema';
import type { AuthUser } from '../common/auth-user';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../access/access.service';
import { NotificationsService } from '../notifications/notifications.service';

const DISPATCH_INTERVAL_MS = 60_000;

@Injectable()
export class AnnouncementsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Announcements');
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    if (config().NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.dispatchDue().catch((err) => this.logger.error(`Dispatch failed: ${String(err)}`));
    }, DISPATCH_INTERVAL_MS);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private columns() {
    return {
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      category: announcements.category,
      priority: announcements.priority,
      audienceType: announcements.audienceType,
      audienceRef: announcements.audienceRef,
      authorName: users.fullName,
      publishAt: announcements.publishAt,
      expiresAt: announcements.expiresAt,
    };
  }

  private toDto(r: { publishAt: Date; expiresAt: Date | null } & Omit<Announcement, 'publishAt' | 'expiresAt'>): Announcement {
    return { ...r, publishAt: r.publishAt.toISOString(), expiresAt: r.expiresAt?.toISOString() ?? null };
  }

  private async visibleCondition(user: AuthUser): Promise<SQL | undefined> {
    const ctx = await this.access.audienceContext(user);
    const now = new Date();
    return and(
      lte(announcements.publishAt, now),
      or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
      this.access.audienceFilter(ctx, { audienceType: announcements.audienceType, audienceRef: announcements.audienceRef }),
    );
  }

  async feed(user: AuthUser, opts: { category?: string; before?: string; limit: number }): Promise<Announcement[]> {
    const category = ANNOUNCEMENT_CATEGORIES.find((c) => c === opts.category);
    const rows = await this.db
      .select(this.columns())
      .from(announcements)
      .innerJoin(users, eq(users.id, announcements.authorId))
      .where(
        and(
          await this.visibleCondition(user),
          category ? eq(announcements.category, category) : undefined,
          opts.before ? lte(announcements.publishAt, new Date(opts.before)) : undefined,
        ),
      )
      // Urgent items that are still fresh float to the top.
      .orderBy(sql`(${announcements.priority} = 'urgent' and ${announcements.publishAt} > now() - interval '3 days') desc`, desc(announcements.publishAt))
      .limit(opts.limit);
    return rows.map((r) => this.toDto(r));
  }

  async findVisible(user: AuthUser, id: string): Promise<Announcement> {
    const [row] = await this.db
      .select(this.columns())
      .from(announcements)
      .innerJoin(users, eq(users.id, announcements.authorId))
      .where(and(eq(announcements.id, id), await this.visibleCondition(user)));
    if (!row) throw new NotFoundException('Announcement not found');
    return this.toDto(row);
  }

  /** Everything the user has authored (or, for leadership, everything), including scheduled and expired items. */
  async manageList(user: AuthUser): Promise<Announcement[]> {
    const rows = await this.db
      .select(this.columns())
      .from(announcements)
      .innerJoin(users, eq(users.id, announcements.authorId))
      .where(isLeadership(user.role) ? undefined : eq(announcements.authorId, user.id))
      .orderBy(desc(announcements.publishAt))
      .limit(200);
    return rows.map((r) => this.toDto(r));
  }

  /** Teachers may address only classes they teach; wider audiences need school-wide rights. */
  private async assertMayTarget(user: AuthUser, input: AnnouncementInput) {
    if (hasPermission(user.role, 'announcements:publish_school_wide')) return;
    if (input.priority === 'urgent') throw new ForbiddenException('Only school leadership can send urgent announcements');
    if (input.audienceType !== 'class' || !input.audienceRef) {
      throw new ForbiddenException('You can only post announcements to classes you teach');
    }
    const classIds = await this.access.readableClassIds(user);
    if (classIds !== 'all' && !classIds.includes(input.audienceRef)) {
      throw new ForbiddenException('You can only post announcements to classes you teach');
    }
  }

  async create(user: AuthUser, input: AnnouncementInput, ip: string | null) {
    await this.assertMayTarget(user, input);
    const [row] = await this.db
      .insert(announcements)
      .values({
        title: input.title,
        body: input.body,
        category: input.category,
        priority: input.priority,
        audienceType: input.audienceType,
        audienceRef: input.audienceType === 'school' ? null : (input.audienceRef ?? null),
        authorId: user.id,
        publishAt: input.publishAt ? new Date(input.publishAt) : new Date(),
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        notifyOnPublish: input.sendPush || input.priority === 'urgent',
      })
      .returning({ id: announcements.id });
    await this.audit.record({ actorId: user.id, action: 'announcement.created', entityType: 'announcement', entityId: row.id, ip });
    await this.dispatchDue([row.id]);
    return row;
  }

  async remove(user: AuthUser, id: string, ip: string | null) {
    const deleted = await this.db
      .delete(announcements)
      .where(and(eq(announcements.id, id), isLeadership(user.role) ? undefined : eq(announcements.authorId, user.id)))
      .returning({ id: announcements.id });
    if (!deleted.length) throw new NotFoundException('Announcement not found');
    await this.audit.record({ actorId: user.id, action: 'announcement.deleted', entityType: 'announcement', entityId: id, ip });
  }

  /**
   * Notifies recipients of announcements that have gone live. Each row is
   * claimed with an UPDATE so that several API instances never notify twice.
   */
  async dispatchDue(onlyIds?: string[]) {
    const claimed = await this.db
      .update(announcements)
      .set({ notifiedAt: new Date() })
      .where(
        and(
          eq(announcements.notifyOnPublish, true),
          isNull(announcements.notifiedAt),
          lte(announcements.publishAt, new Date()),
          onlyIds ? inArray(announcements.id, onlyIds) : undefined,
        ),
      )
      .returning();
    for (const a of claimed) {
      const recipients = await this.notifications.audienceUserIds(a.audienceType, a.audienceRef);
      await this.notifications.notify(
        recipients.filter((id) => id !== a.authorId),
        {
          type: 'announcement',
          title: a.priority === 'urgent' ? `URGENT: ${a.title}` : a.title,
          body: a.body.length > 140 ? `${a.body.slice(0, 137)}…` : a.body,
          data: { announcementId: a.id },
        },
        { push: true },
      );
    }
  }
}

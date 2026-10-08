import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { hash } from 'argon2';
import { and, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import type {
  CreateUserInput,
  LinkGuardianInput,
  ListUsersQuery,
  Paginated,
  UpdateUserInput,
  UserListItem,
} from '@sda-shs/shared';
import { InjectDb, type Database } from '../database/database.module';
import { auditLogs, classes, guardianStudents, sessions, staffProfiles, students, users } from '../database/schema';
import type { AuthUser } from '../common/auth-user';
import { AuditService } from '../common/audit.service';
import { MeService } from '../auth/me.service';
import { CurriculumService } from '../academics/curriculum.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly audit: AuditService,
    private readonly me: MeService,
    private readonly curriculum: CurriculumService,
  ) {}

  /** Only a super administrator may create or change another super administrator. */
  private assertMayManage(actor: AuthUser, targetRole: string) {
    if (targetRole === 'super_admin' && actor.role !== 'super_admin') {
      throw new ForbiddenException('Only a super administrator can manage super administrator accounts');
    }
  }

  async list(q: ListUsersQuery): Promise<Paginated<UserListItem>> {
    const conds: (SQL | undefined)[] = [];
    if (q.role) conds.push(eq(users.role, q.role));
    if (q.classId) conds.push(eq(students.classId, q.classId));
    if (q.search) {
      const term = `%${q.search.replace(/[%_\\]/g, '\\$&')}%`;
      conds.push(
        or(
          ilike(users.fullName, term),
          ilike(users.email, term),
          ilike(users.phone, term),
          ilike(students.studentNumber, term),
          ilike(staffProfiles.staffNumber, term),
        ),
      );
    }
    const where = and(...conds);
    const base = () =>
      this.db
        .select({
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          phone: users.phone,
          role: users.role,
          status: users.status,
          studentNumber: students.studentNumber,
          staffNumber: staffProfiles.staffNumber,
          className: classes.name,
          lastLoginAt: users.lastLoginAt,
        })
        .from(users)
        .leftJoin(students, eq(students.userId, users.id))
        .leftJoin(classes, eq(classes.id, students.classId))
        .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id));

    const [items, [{ total }]] = await Promise.all([
      base()
        .where(where)
        .orderBy(users.fullName)
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ total: count() })
        .from(users)
        .leftJoin(students, eq(students.userId, users.id))
        .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
        .where(where),
    ]);
    return {
      items: items.map((i) => ({ ...i, lastLoginAt: i.lastLoginAt?.toISOString() ?? null })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async detail(id: string) {
    const me = await this.me.build(id);
    const guardians =
      me.role === 'student' && me.student
        ? await this.db
            .select({ id: users.id, fullName: users.fullName, phone: users.phone, email: users.email, relationship: guardianStudents.relationship })
            .from(guardianStudents)
            .innerJoin(users, eq(users.id, guardianStudents.guardianUserId))
            .where(eq(guardianStudents.studentId, me.student.id))
        : [];
    const [user] = await this.db.select({ status: users.status, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt }).from(users).where(eq(users.id, id));
    return { ...me, ...user, guardians };
  }

  /** An option must belong to the student's class (same programme and stream). */
  private async assertOptionFits(combinationId: string | null | undefined, classId: string) {
    if (combinationId && !(await this.curriculum.combinationFitsClass(combinationId, classId))) {
      throw new BadRequestException("That option doesn't belong to this class");
    }
  }

  async create(actor: AuthUser, input: CreateUserInput, ip: string | null) {
    this.assertMayManage(actor, input.role);
    if (input.student) await this.assertOptionFits(input.student.combinationId, input.student.classId);
    const passwordHash = await hash(input.temporaryPassword);

    const id = await this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          fullName: input.fullName,
          email: input.email?.toLowerCase() ?? null,
          phone: input.phone ?? null,
          role: input.role,
          passwordHash,
          mustChangePassword: true,
        })
        .returning({ id: users.id });
      if (input.student) {
        await tx.insert(students).values({
          userId: user.id,
          studentNumber: input.student.studentNumber.toUpperCase(),
          classId: input.student.classId,
          combinationId: input.student.combinationId ?? null,
          houseId: input.student.houseId ?? null,
          dateOfBirth: input.student.dateOfBirth ?? null,
        });
      }
      if (input.staff && input.role !== 'student' && input.role !== 'parent') {
        await tx.insert(staffProfiles).values({ userId: user.id, staffNumber: input.staff.staffNumber.toUpperCase() });
      }
      return user.id;
    });

    await this.audit.record({ actorId: actor.id, action: 'user.created', entityType: 'user', entityId: id, metadata: { role: input.role }, ip });
    return this.detail(id);
  }

  private async roleOf(id: string) {
    const [row] = await this.db.select({ role: users.role }).from(users).where(eq(users.id, id));
    if (!row) throw new NotFoundException('Account not found');
    return row.role;
  }

  async update(actor: AuthUser, id: string, input: UpdateUserInput, ip: string | null) {
    this.assertMayManage(actor, await this.roleOf(id));
    if (id === actor.id && input.status === 'deactivated') {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    const { classId, combinationId, houseId, droppedSubjectId, ...fields } = input;
    const studentChanges = classId !== undefined || combinationId !== undefined || houseId !== undefined || droppedSubjectId !== undefined;
    if (studentChanges) {
      const [student] = await this.db.select().from(students).where(eq(students.userId, id));
      if (!student) throw new BadRequestException('Only students have a class, option or house');
      const targetClass = classId ?? student.classId;
      // Moving class without choosing a new option clears an option that no longer fits.
      let targetCombination = combinationId === undefined ? student.combinationId : combinationId;
      if (combinationId === undefined && classId && targetCombination && !(await this.curriculum.combinationFitsClass(targetCombination, targetClass))) {
        targetCombination = null;
      }
      await this.assertOptionFits(targetCombination, targetClass);
      // A new class or option clears the dropped subject unless one is chosen in the same change.
      const optionChanged = targetClass !== student.classId || targetCombination !== student.combinationId;
      await this.db
        .update(students)
        .set({
          classId: targetClass,
          combinationId: targetCombination,
          houseId: houseId === undefined ? student.houseId : houseId,
          droppedSubjectId: optionChanged ? null : student.droppedSubjectId,
        })
        .where(eq(students.id, student.id));
      if (droppedSubjectId !== undefined) {
        if (droppedSubjectId) {
          const allowed = (await this.curriculum.subjectChoice(student.id)).allowed;
          if (!allowed.some((s) => s.id === droppedSubjectId)) {
            throw new BadRequestException(
              allowed.length
                ? `This student can only drop ${allowed.map((s) => s.name).join(' or ')}`
                : "This student's option has no subject to drop",
            );
          }
        }
        await this.db.update(students).set({ droppedSubjectId: droppedSubjectId ?? null }).where(eq(students.id, student.id));
      }
    }
    await this.db.transaction(async (tx) => {
      if (Object.keys(fields).length) {
        await tx
          .update(users)
          .set({ ...fields, email: fields.email === undefined ? undefined : (fields.email?.toLowerCase() ?? null) })
          .where(eq(users.id, id));
      }
      if (input.status === 'deactivated') {
        await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, id), isNull(sessions.revokedAt)));
      }
    });
    await this.audit.record({ actorId: actor.id, action: 'user.updated', entityType: 'user', entityId: id, metadata: { fields: Object.keys(input) }, ip });
    return this.detail(id);
  }

  async resetPassword(actor: AuthUser, id: string, temporaryPassword: string, ip: string | null) {
    this.assertMayManage(actor, await this.roleOf(id));
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash: await hash(temporaryPassword), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null })
        .where(eq(users.id, id));
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, id), isNull(sessions.revokedAt)));
    });
    await this.audit.record({ actorId: actor.id, action: 'user.password_reset', entityType: 'user', entityId: id, ip });
  }

  async linkGuardian(actor: AuthUser, input: LinkGuardianInput, ip: string | null) {
    if ((await this.roleOf(input.guardianUserId)) !== 'parent') {
      throw new BadRequestException('Only parent/guardian accounts can be linked to a student');
    }
    await this.db.insert(guardianStudents).values(input).onConflictDoUpdate({
      target: [guardianStudents.guardianUserId, guardianStudents.studentId],
      set: { relationship: input.relationship },
    });
    await this.audit.record({ actorId: actor.id, action: 'guardian.linked', entityType: 'student', entityId: input.studentId, metadata: { guardianUserId: input.guardianUserId }, ip });
  }

  async unlinkGuardian(actor: AuthUser, guardianUserId: string, studentId: string, ip: string | null) {
    await this.db
      .delete(guardianStudents)
      .where(and(eq(guardianStudents.guardianUserId, guardianUserId), eq(guardianStudents.studentId, studentId)));
    await this.audit.record({ actorId: actor.id, action: 'guardian.unlinked', entityType: 'student', entityId: studentId, metadata: { guardianUserId }, ip });
  }

  async auditLog(limit: number) {
    return this.db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        metadata: auditLogs.metadata,
        ipAddress: auditLogs.ipAddress,
        createdAt: auditLogs.createdAt,
        actorName: users.fullName,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }
}

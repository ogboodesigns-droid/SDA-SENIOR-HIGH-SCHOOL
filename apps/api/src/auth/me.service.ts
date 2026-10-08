import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { ROLE_PERMISSIONS, type Me, type StudentSummary } from '@sda-shs/shared';
import { InjectDb, type Database } from '../database/database.module';
import { classes, guardianStudents, programmes, students, users } from '../database/schema';

@Injectable()
export class MeService {
  constructor(@InjectDb() private readonly db: Database) {}

  async studentSummaries(where: { userId?: string; studentIds?: string[] }): Promise<StudentSummary[]> {
    const cond = where.userId ? eq(students.userId, where.userId) : inArray(students.id, where.studentIds ?? []);
    if (where.studentIds && !where.studentIds.length) return [];
    return this.db
      .select({
        id: students.id,
        userId: students.userId,
        fullName: users.fullName,
        studentNumber: students.studentNumber,
        classId: classes.id,
        className: classes.name,
        form: classes.form,
        programmeName: programmes.name,
      })
      .from(students)
      .innerJoin(users, eq(users.id, students.userId))
      .innerJoin(classes, eq(classes.id, students.classId))
      .innerJoin(programmes, eq(programmes.id, classes.programmeId))
      .where(cond)
      .orderBy(users.fullName);
  }

  async build(userId: string): Promise<Me> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundException('Account not found');

    let student: StudentSummary | null = null;
    let children: StudentSummary[] = [];
    let formClassIds: string[] = [];

    if (user.role === 'student') {
      [student = null] = await this.studentSummaries({ userId });
    } else if (user.role === 'parent') {
      const links = await this.db
        .select({ id: guardianStudents.studentId })
        .from(guardianStudents)
        .where(eq(guardianStudents.guardianUserId, userId));
      children = await this.studentSummaries({ studentIds: links.map((l) => l.id) });
    } else if (user.role === 'teacher') {
      const rows = await this.db.select({ id: classes.id }).from(classes).where(eq(classes.formMasterId, userId));
      formClassIds = rows.map((r) => r.id);
    }

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      permissions: [...ROLE_PERMISSIONS[user.role]],
      mustChangePassword: user.mustChangePassword,
      student,
      children,
      formClassIds,
    };
  }
}

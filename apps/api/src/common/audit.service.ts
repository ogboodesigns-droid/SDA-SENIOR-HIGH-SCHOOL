import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { InjectDb, type Database } from '../database/database.module';
import { auditLogs } from '../database/schema';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Append-only record of security-relevant and data-changing actions. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(@InjectDb() private readonly db: Database) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata ?? null,
        ipAddress: entry.ip ?? null,
      });
    } catch (err) {
      // Never fail the user's request because the audit write failed, but make it loud.
      this.logger.error(`Failed to write audit entry ${entry.action}: ${String(err)}`);
    }
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}

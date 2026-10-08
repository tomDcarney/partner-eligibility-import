import Database from 'better-sqlite3';
import { CanonicalMember } from '../domain/member.js';

export type UpsertOutcome = 'inserted' | 'updated' | 'unchanged';

const MUTABLE_FIELDS = [
  'first_name',
  'last_name',
  'date_of_birth',
  'email',
  'policy_start',
  'policy_end',
] as const;

/**
 * SQLite-backed member store. Members are keyed strictly by the composite
 * (partner_id, partner_member_id) primary key — the stable member
 * identity — so changing any mutable field (email, name, dates) updates
 * the existing row in place and never creates a second member. Data
 * persists across process restarts because it is written to a file on
 * disk (or an explicit in-memory DB for tests).
 */
export class SqliteStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS members (
        partner_id TEXT NOT NULL,
        partner_member_id TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        date_of_birth TEXT,
        email TEXT,
        policy_start TEXT,
        policy_end TEXT,
        PRIMARY KEY (partner_id, partner_member_id)
      );
    `);
  }

  /**
   * Insert or update a member by identity, detecting whether the write
   * was a true no-op (unchanged), an update to an existing row, or a
   * brand-new insert.
   */
  upsert(member: CanonicalMember): UpsertOutcome {
    const existing = this.findByIdentity(member.partner_id, member.partner_member_id);

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO members
            (partner_id, partner_member_id, first_name, last_name, date_of_birth, email, policy_start, policy_end)
           VALUES (@partner_id, @partner_member_id, @first_name, @last_name, @date_of_birth, @email, @policy_start, @policy_end)`,
        )
        .run(member);
      return 'inserted';
    }

    const changed = MUTABLE_FIELDS.some((field) => existing[field] !== member[field]);
    if (!changed) {
      return 'unchanged';
    }

    this.db
      .prepare(
        `UPDATE members SET
           first_name = @first_name,
           last_name = @last_name,
           date_of_birth = @date_of_birth,
           email = @email,
           policy_start = @policy_start,
           policy_end = @policy_end
         WHERE partner_id = @partner_id AND partner_member_id = @partner_member_id`,
      )
      .run(member);
    return 'updated';
  }

  findByIdentity(partnerId: string, partnerMemberId: string): CanonicalMember | null {
    const row = this.db
      .prepare(
        `SELECT partner_id, partner_member_id, first_name, last_name, date_of_birth, email, policy_start, policy_end
         FROM members WHERE partner_id = ? AND partner_member_id = ?`,
      )
      .get(partnerId, partnerMemberId) as CanonicalMember | undefined;
    return row ?? null;
  }

  close(): void {
    this.db.close();
  }
}

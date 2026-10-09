#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadProfile } from './profiles/index.js';
import { SqliteStore } from './store/sqlite-store.js';
import { runImport } from './import/importer.js';

function parseArgs(argv: string[]): { file: string; partnerId: string; dbPath: string } {
  const positional: string[] = [];
  let partnerId: string | undefined;
  let dbPath = 'data/members.db';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--partner') {
      partnerId = argv[++i];
    } else if (arg === '--db') {
      dbPath = argv[++i] ?? dbPath;
    } else if (arg !== undefined) {
      positional.push(arg);
    }
  }

  const file = positional[0];
  if (!file || !partnerId) {
    throw new Error(
      'Usage: npm run import -- <file.csv> --partner <partnerId> [--db <path>]',
    );
  }
  return { file, partnerId, dbPath };
}

function main(): void {
  let store: SqliteStore | undefined;

  try {
    const [, , command, ...rest] = process.argv;

    if (command !== 'import') {
      console.error('Usage: npm run import -- <file.csv> --partner <partnerId> [--db <path>]');
      process.exitCode = 1;
      return;
    }

    const { file, partnerId, dbPath } = parseArgs(rest);
    const profile = loadProfile(partnerId);

    mkdirSync(dirname(dbPath), { recursive: true });
    store = new SqliteStore(dbPath);

    const summary = runImport(file, profile, store);

    console.log(`Import complete: ${summary.filePath} (partner: ${summary.partnerId})`);
    console.log(`  Total rows:  ${summary.totalRows}`);
    console.log(`  Inserted:    ${summary.inserted}`);
    console.log(`  Updated:     ${summary.updated}`);
    console.log(`  Unchanged:   ${summary.unchanged}`);
    console.log(`  Rejected:    ${summary.rejected.length}`);

    if (summary.duplicates.length > 0) {
      console.log('\nDuplicate partner_member_id within file (last row wins):');
      for (const dup of summary.duplicates) {
        console.log(`  - ${dup.partnerMemberId}: rows ${dup.rowNumbers.join(', ')}`);
      }
    }

    if (summary.rejected.length > 0) {
      console.log('\nRejected rows:');
      for (const row of summary.rejected) {
        const id = row.partnerMemberId ?? '(no id)';
        for (const r of row.rejections) {
          console.log(`  - row ${row.rowNumber} [${id}]: ${r.field} - ${r.reason}`);
        }
      }
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    store?.close();
  }
}

main();

import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SAMPLE_ACME = join(process.cwd(), 'sample-data', 'acme-insurance.csv');
const CLI = join(process.cwd(), 'src', 'cli.ts');

describe('cli import command (integration)', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('prints a summary with counts and rejection reasons, and is idempotent on rerun', () => {
    dir = mkdtempSync(join(tmpdir(), 'perci-cli-test-'));
    const dbPath = join(dir, 'members.db');

    const run = (): string =>
      execFileSync(
        'node',
        [
          '--import=tsx/esm',
          '--no-warnings',
          CLI,
          'import',
          SAMPLE_ACME,
          '--partner',
          'acme-insurance',
          '--db',
          dbPath,
        ],
        { encoding: 'utf-8' },
      );

    const first = run();
    expect(first).toContain('Inserted:    3');
    expect(first).toContain('Rejected:    5');
    expect(first).toContain('missing required field');
    expect(first).toContain('Duplicate partner_member_id within file');

    const second = run();
    expect(second).toContain('Inserted:    0');
    expect(second).toContain('Updated:     0');
    expect(second).toContain('Unchanged:   3');
  });

  it('prints a clean error message (not a raw stack trace) and exits non-zero for an unknown partner', () => {
    dir = mkdtempSync(join(tmpdir(), 'perci-cli-test-'));
    const dbPath = join(dir, 'members.db');

    let error: unknown;
    try {
      execFileSync(
        'node',
        [
          '--import=tsx/esm',
          '--no-warnings',
          CLI,
          'import',
          SAMPLE_ACME,
          '--partner',
          'does-not-exist',
          '--db',
          dbPath,
        ],
        { encoding: 'utf-8' },
      );
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    const e = error as { status: number | null; stderr: string };
    expect(e.status).not.toBe(0);
    expect(e.stderr).toContain('Unknown partner "does-not-exist"');
    expect(e.stderr).not.toContain('at Object.<anonymous>');
    expect(e.stderr).not.toContain('.ts:');
  });
}, 30_000);

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createServer } from '../src/http/server.js';
import { SqliteStore } from '../src/store/sqlite-store.js';
import { runImport } from '../src/import/importer.js';
import { acmeInsuranceProfile } from '../src/profiles/acme-insurance.js';
import { join } from 'node:path';

const SAMPLE_ACME = join(process.cwd(), 'sample-data', 'acme-insurance.csv');

describe('HTTP member lookup', () => {
  let store: SqliteStore;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    store = new SqliteStore(':memory:');
    runImport(SAMPLE_ACME, acmeInsuranceProfile, store);
    server = createServer(store);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  });

  it('returns the stored member on a hit', async () => {
    const res = await fetch(`${baseUrl}/members/AM-1001?partner=acme-insurance`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      partner_id: 'acme-insurance',
      partner_member_id: 'AM-1001',
      first_name: 'Jane',
      last_name: 'Doe',
    });
  });

  it('returns a clean 404 on a miss, not a crash', async () => {
    const res = await fetch(`${baseUrl}/members/does-not-exist?partner=acme-insurance`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('supports partner scoping via the x-partner-id header', async () => {
    const res = await fetch(`${baseUrl}/members/AM-1002`, {
      headers: { 'x-partner-id': 'acme-insurance' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.partner_member_id).toBe('AM-1002');
  });

  it('returns 400 when no partner scope is given', async () => {
    const res = await fetch(`${baseUrl}/members/AM-1001`);
    expect(res.status).toBe(400);
  });
});

import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SqliteStore } from '../store/sqlite-store.js';

/**
 * Member lookup HTTP server. `GET /members/:partner_member_id` scoped to
 * a partner via either a `?partner=` query string or an `x-partner-id`
 * header. Returns the canonical member as JSON on a hit, or a clean 404
 * JSON body (never a crash) on a miss or missing partner scope.
 */
export function createServer(store: SqliteStore) {
  return createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    try {
      handleRequest(req, res, store);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal error' }));
    }
  });
}

function handleRequest(req: IncomingMessage, res: ServerResponse, store: SqliteStore): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const match = /^\/members\/([^/]+)$/.exec(url.pathname);

  if (req.method !== 'GET' || !match) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  const partnerMemberId = decodeURIComponent(match[1]!);
  const partnerId = url.searchParams.get('partner') ?? req.headers['x-partner-id'];

  if (!partnerId || Array.isArray(partnerId)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'missing partner scope: pass ?partner=<id> or x-partner-id header',
      }),
    );
    return;
  }

  const member = store.findByIdentity(partnerId, partnerMemberId);

  if (!member) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'member not found' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(member));
}

function main(): void {
  const dbPath = process.env.MEMBERS_DB_PATH ?? 'data/members.db';
  const port = Number(process.env.PORT ?? 3000);

  mkdirSync(dirname(dbPath), { recursive: true });
  const store = new SqliteStore(dbPath);
  const server = createServer(store);

  server.on('error', (err) => {
    console.error(err.message);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`Member lookup server listening on http://localhost:${port}`);
    console.log(`  GET /members/:partner_member_id?partner=<partnerId>`);
  });

  process.on('SIGINT', () => {
    server.close();
    store.close();
    process.exit(0);
  });
}

// Only auto-start when run directly (`npm run serve`), not when imported by tests.
if (process.argv[1] && /server\.(ts|js)$/.test(process.argv[1])) {
  main();
}

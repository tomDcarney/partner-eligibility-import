# Partner Eligibility Import

A small TypeScript/Node.js importer for partner eligibility CSV files. It
parses a file, validates and normalises each row against a per-partner
**source profile**, upserts the valid rows into persistent storage keyed
by a stable member identity, and reports every accepted/rejected row with
reasons. Member lookup is exposed over HTTP. The pipeline generalises
across partners via configuration, not partner-specific code branches.

## Pipeline

```
src/domain      canonical Member + SourceProfile types, identity fn
src/profiles    per-partner profiles (column map, date format, required fields) + loader
src/csv         CSV reader -- maps a partner's raw headers onto canonical field names
src/validate    validates/normalises one raw record into a canonical member, or rejects it
src/store       SQLite store -- upsert keyed by (partner_id, partner_member_id)
src/import      orchestrator: read -> validate -> upsert -> summary
src/cli.ts      `import` command
src/http/server.ts   `GET /members/:partner_member_id` lookup endpoint
```

Both entry points (`cli.ts`, `http/server.ts`) call the same importer and
store. The core pipeline (`csv`, `validate`, `store`, `import`) only ever
depends on `domain` types — it never branches on a specific partner.

## Decisions (and why)

- **Storage: SQLite.** Persists across process restarts (a hard
  requirement) and its native `INSERT ... ON CONFLICT` / explicit
  read-then-write semantics make idempotent upsert and fast lookup by
  primary key straightforward, without standing up an external database
  for a local demo.

- **Member identity: composite `(partner_id, partner_member_id)`.**
  `partner_id` isn't a CSV column — a single partner's file never
  contains it — so it's supplied at import time as a CLI flag (or query
  param/header for lookup) that selects the active source profile.
  Identity is computed only from these two immutable-for-a-given-row
  values, never from mutable fields like email or name, so editing any
  mutable field updates the existing row in place instead of creating a
  second member (see `src/domain/member.ts: memberIdentity`).

- **Lookup interface: HTTP, `GET /members/:partner_member_id`.** Partner
  scope is supplied via `?partner=<id>` query string or an
  `x-partner-id` header (query takes precedence if both are given). A
  miss returns a clean `404 {"error": "member not found"}` rather than
  throwing; a request with no partner scope at all returns `400`, also
  without crashing.

- **Generality: config-driven source profiles.** Each partner is one
  `SourceProfile` object (`src/profiles/*.ts`) declaring: the mapping
  from canonical field name to that partner's actual CSV column header,
  the date format used in that file, and which canonical fields that
  partner's file is allowed to leave blank. `src/csv/reader.ts` is the
  only place that reads a partner's own header names; everything
  downstream (`validate`, `store`, `import`) only ever sees canonical
  field names. Onboarding a third partner means adding one more profile
  file and registering it in `src/profiles/index.ts` — zero changes to
  `csv`, `validate`, `store`, or `import`.

- **Validation: strict core defaults, profile-relaxable specifics.**
  Dates must be real ISO-8601 calendar dates once normalised (no
  "Feb 30", no "31/02/2020"); email must look like an email; DOB must be
  in the past; `policy_end >= policy_start`. A profile can declare a
  different raw date format (e.g. `DD/MM/YYYY`) which the validator
  parses and normalises to ISO-8601 before storage — the format varies,
  the strictness doesn't.

- **Required fields: all seven by default, profile can mark some
  optional.** `partner_member_id` is always required (it's half of
  member identity); the other six default to required but a profile may
  list any of them under `optionalFields` (e.g. the sample
  `beacon-employer` profile marks `email` optional, for members with no
  email on file).

- **In-file duplicates: deterministic last-wins, reported as a
  warning.** If the same `partner_member_id` appears twice (validly) in
  one file, the later row's values are the ones stored; the import
  summary reports every such collision by id and row numbers so it's
  never silently resolved.

## Canonical fields

`partner_member_id, first_name, last_name, date_of_birth, email, policy_start, policy_end`

Dates are stored and returned as ISO-8601 (`YYYY-MM-DD`) regardless of
the source file's original date format.

## Running it

```bash
npm install

# Type-check and build
npm run build

# Run the test suite
npm test

# Import a file for a given partner (creates data/members.db on first run)
npm run import -- sample-data/acme-insurance.csv --partner acme-insurance
npm run import -- sample-data/beacon-employer.csv --partner beacon-employer

# Re-run the same file: idempotent (0 inserted, 0 updated, N unchanged)
npm run import -- sample-data/acme-insurance.csv --partner acme-insurance

# Optionally point at a different database file
npm run import -- sample-data/acme-insurance.csv --partner acme-insurance --db /tmp/members.db

# Start the lookup server (reads data/members.db by default)
npm run serve
# in another shell:
curl "http://localhost:3000/members/AM-1001?partner=acme-insurance"
curl "http://localhost:3000/members/does-not-exist?partner=acme-insurance"   # 404
curl -H "x-partner-id: acme-insurance" "http://localhost:3000/members/AM-1002"
```

`MEMBERS_DB_PATH` and `PORT` env vars configure the server's database
path and port.

## Sample data

- `sample-data/acme-insurance.csv` — canonical-shaped columns, ISO
  dates. Includes deliberately broken rows: a future DOB, an impossible
  calendar date (`1978-02-30`), a malformed email, `policy_end` before
  `policy_start`, a missing required field (`first_name`), and an
  in-file duplicate `partner_member_id` (last row wins).
- `sample-data/beacon-employer.csv` — a second partner with renamed
  columns (`EmployeeID`, `GivenName`, `DOB`, ...), `DD/MM/YYYY` dates,
  and one row with no email (allowed, since this profile marks `email`
  optional). Demonstrates the same pipeline handling a differently
  shaped file with zero core-code changes.

## Testing

Three layers, all under `test/`, run with `npm test` (vitest):

- `validate.test.ts` — unit tests for every validation rule: missing
  required field, malformed/impossible date, future DOB, `policy_end`
  before `policy_start`, invalid email, multiple simultaneous failures
  reported together, and date-format/optional-field handling via the
  second profile.
- `store.test.ts` — unit tests for SQLite upsert semantics directly:
  insert on first write, no-op on an identical re-write, update on a
  changed field, and proof that identity is keyed strictly by
  `(partner_id, partner_member_id)` (an email change updates in place;
  the same id under a different partner is a distinct member).
- `importer.test.ts` — integration tests driving the sample CSV through
  the full pipeline: first run's accepted/rejected counts and reasons,
  a second unchanged run (0/0/N), a third run with one field edited
  (exactly one update), the in-file duplicate warning, and the second
  partner's profile importing through the same code path.
- `http.test.ts` — integration test for the lookup endpoint: hit,
  clean 404 on miss, header-based partner scoping, and 400 with no
  partner scope.
- `cli.test.ts` — integration test running the actual `import` command
  as a subprocess twice, asserting the printed summary and idempotency.

Out of scope (per spec): load/performance testing and testing against
real partner data — only the sample CSVs are used.

## Known limitations / left incomplete

- No batch/multi-file orchestration, scheduling, or auth — out of scope
  per the spec's boundaries.
- The email format check is a pragmatic regex (`local@domain.tld`
  shape), not full RFC 5322 validation.
- `partner_id` is trusted as supplied (CLI flag / query param / header);
  there is no partner registry beyond the two sample `SourceProfile`s
  checked into `src/profiles/`.

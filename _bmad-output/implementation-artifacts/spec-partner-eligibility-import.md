---
title: 'Partner Eligibility Import'
type: 'feature'
created: '2026-10-06'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: 'NO_VCS'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Perci receives eligibility lists (CSV) from many B2B partners (insurers, employers). We need to import one of these lists reliably: parse it, validate rows, store the valid ones, and expose member lookup — in a way that generalises across partners rather than being hard-wired to one client's file.

**Approach:** A small TypeScript/Node.js importer with a clear pipeline — read CSV → validate/normalise each row against a per-partner source profile → upsert into persistent storage keyed by a stable member identity → report accepted/rejected rows with reasons. Lookup by `partner_member_id` is exposed through a thin interface. Re-running the same file is idempotent; changed rows update in place.

## Boundaries & Constraints

**Always:**
- Imports are idempotent: re-importing a file never duplicates members; unchanged rows are no-ops and changed rows update the existing record in place.
- Every rejected row is reported with the specific field(s) and reason(s) it failed; one bad row never aborts the whole import.
- Member identity is stable and explicit, so a changed email does not create a second member.
- Partner-specific details (which partner the file belongs to, column names, date formats, validation rules) live in configuration/data, not in hard-coded branches, so a new partner can be onboarded without rewriting the core pipeline.
- Valid rows persist across process restarts (the store survives between runs).

**Never:**
- No real PII beyond the sample file; no external network calls to partner systems.
- No partner-specific `if (partner === 'X')` branching in core logic.
- No multi-file / batch-directory orchestration, scheduling, or auth beyond what the lookup interface needs for a local demo.
- No UI beyond the chosen lookup interface.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | CSV with all valid rows | All rows stored; summary reports N accepted, 0 rejected | N/A |
| Re-import unchanged | Same file imported twice | Second run: 0 inserts, 0 updates, N unchanged | N/A |
| Re-import with a changed field | Row's last_name (or dates) changed | That member updated in place; others unchanged | N/A |
| Missing required field | Row missing e.g. partner_member_id or DOB | Row rejected, others still imported | Report row + field + "missing required field" |
| Malformed date | date_of_birth = "31/02/2020" or garbage | Row rejected | Report row + field + "invalid date" |
| policy_end before policy_start | start 2025-01-01, end 2024-01-01 | Row rejected | Report row + "policy_end before policy_start" |
| Duplicate id within one file | Two rows, same partner_member_id | Deterministic resolution (last-wins) with a reported warning | Report the collision |
| Lookup hit / miss | Query by partner_member_id | Return member record / not-found response | Not-found is a clean response, not a crash |

## Decisions

- **Storage:** SQLite (persists across runs; native upsert backs idempotent dedupe and lookup).
- **Member identity:** composite `(partner_id, partner_member_id)`. `partner_id` is supplied at import time (CLI flag selecting a source profile), since the CSV has no partner column. A changed email never creates a second member.
- **Lookup interface:** HTTP endpoint, `GET /members/:partner_member_id` (partner scoped via query/header or path), returning JSON; clean 404 on miss.
- **Generality:** config-driven source profiles. Each partner has a profile declaring column mapping, date format, required-field set, and validation overrides. The core pipeline only ever handles canonical records; partner differences are data, not code.
- **Validation:** strict core defaults — dates must be real ISO-8601 (`YYYY-MM-DD`), email must look valid, DOB must be in the past, `policy_end >= policy_start` — with a source profile able to relax specifics (e.g. accept `DD/MM/YYYY`).
- **Required fields:** default is all seven columns required; a source profile may mark fields optional (e.g. open-ended policies or members with no email on file).

</frozen-after-approval>

## Code Map

Greenfield TypeScript/Node.js project — no existing source. Layering (files created in Tasks below): `src/domain` (canonical `Member` + `SourceProfile` types, identity fn) ← `src/profiles` (per-partner profiles + loader) → consumed by `src/csv` (reader), `src/validate`, `src/store` (SQLite), `src/import` (orchestrator). Entry points `src/cli.ts` and `src/http/server.ts` both call the same importer/store. Core pipeline depends only on `domain`, never on a concrete partner.

## Tasks & Acceptance

**Execution:**
- [x] `package.json` / `tsconfig.json` -- scaffold TS/Node project with a test runner (vitest or node:test) and build/import/serve scripts
- [x] `src/domain/member.ts`, `src/domain/profile.ts` -- define canonical member + source-profile types and the identity function
- [x] `src/profiles/` -- author two source profiles (canonical + one with renamed columns / different date format) and a loader keyed by partner_id
- [x] `src/csv/reader.ts` -- parse CSV to raw records, mapping headers through the active profile
- [x] `src/validate/validate.ts` -- validate/normalise a raw record against a profile; return accepted canonical member or structured rejection(s) with field + reason
- [x] `src/store/sqlite-store.ts` -- SQLite store with upsert keyed by `(partner_id, partner_member_id)` and change detection distinguishing insert/update/unchanged
- [x] `src/import/importer.ts` -- orchestrate read → validate → upsert; produce an accepted/updated/unchanged/rejected summary; one bad row never aborts the run
- [x] `src/cli.ts` -- `import` command that runs the importer and prints the summary and every rejection with its reason
- [x] `src/http/server.ts` -- HTTP endpoint `GET /members/:partner_member_id` returning the member JSON or a clean 404
- [x] `sample-data/*.csv` -- sample file with a handful of rows including deliberately broken ones (bad date, missing field, policy_end before start, in-file duplicate)
- [x] `test/*` -- see Testing Strategy below for exact coverage
- [x] `README.md` -- document every decision in the Decisions section and how to run import + lookup

**Acceptance Criteria:**
- Given a sample CSV, when imported twice, then the second run creates no duplicates and reports all rows unchanged.
- Given a row changed since last import, when re-imported, then the stored record is updated in place and reported as updated.
- Given invalid rows, when imported, then each is rejected with a specific field + reason and the valid rows still import.
- Given a stored member, when looked up by partner_member_id over HTTP, then the record is returned; a missing id returns a clean 404.
- Given a second partner's file with different column names/date format, when its source profile is supplied, then it imports through the same pipeline with no core-code change.

## Testing Strategy

Automated, no manual steps. Three layers:

- **Unit — `validate`**: one case per I/O & Edge-Case Matrix row that is a validation concern (missing required field, malformed date, policy_end before policy_start, email format) -- asserts the specific field + reason returned, not just pass/fail.
- **Unit — `store`**: upsert semantics directly against the SQLite store -- insert on first write, no-op on identical re-write, update on changed fields, keyed strictly by `(partner_id, partner_member_id)` so an email change never creates a second row.
- **Integration — `importer` (and one `http`/`cli` test)**: drives the sample CSV (with its deliberately broken rows) through the full pipeline twice -- first run reports correct inserted/rejected counts with reasons; second, unchanged run reports 0 inserts/0 updates/N unchanged; a third run with one row edited reports exactly one update. Plus: in-file duplicate `partner_member_id` resolves deterministically with a warning, lookup returns the stored member and a clean 404 on a miss, and a second source profile (different columns/date format) imports successfully through the same code path to prove genericity.

Out of scope: load/performance testing, and testing against real partner data (sample CSV only).

## Implementation Notes

- Implemented as a TypeScript/Node.js project (ESM, `tsx` for dev execution, `tsc` for the build/typecheck acceptance command) using `better-sqlite3` for storage and `csv-parse` for CSV parsing.
- Canonical member has 7 fields; `partner_member_id` is always required (it is half of member identity) even when a profile marks other fields optional.
- Two source profiles shipped: `acme-insurance` (canonical columns, ISO dates, all fields required) and `beacon-employer` (renamed columns, `DD/MM/YYYY` dates, `email` optional) — proving genericity per the acceptance criteria.
- In-file duplicate `partner_member_id` resolves last-wins and is reported in the import summary as a `duplicates` list (id + row numbers), per the Edge-Case Matrix.
- HTTP lookup supports partner scoping via `?partner=` query string or `x-partner-id` header; a request with neither returns 400 (not a crash), and a miss returns a clean 404 JSON body.
- Verified: `npm run build` (tsc, no emit errors), `npm test` (26/26 passing across validate/store/importer/http/cli test files), and manual end-to-end runs of `npm run import` (first run 3 inserted/5 rejected/1 duplicate warning; rerun 0/0/3 unchanged) and `npm run serve` (200 on hit, 404 on miss).

## Spec Change Log

## Review Triage Log

- **medium** — `src/csv/reader.ts`: csv-parse throws synchronously on a row with a different column count than the header, aborting the *entire* import, not just that row. Verified: `parse('a,b,c\n1,2\n', {columns:true})` throws `Invalid Record Length`. Contradicts the spec's "one bad row never aborts the whole import" invariant. Route: patch (add `relax_column_count: true`).
- **low** — `src/cli.ts`: `parseArgs()`/`loadProfile()`/`mkdirSync`/`new SqliteStore()` all run outside any try/catch in `main()`, so bad args, an unknown `--partner`, or an unreadable file surface as a raw uncaught stack trace instead of the tool's own clean error style (unlike the HTTP server, which catches every request). Verified by reading `src/cli.ts` lines ~287-333. Route: patch (wrap `main()` body in try/catch).
- **false** — DOB-past check allegedly mixes "local server time" with UTC getters. `new Date()` is a UTC timestamp regardless of locale; `getUTCFullYear/Month/Date()` extracts the UTC calendar date consistently with every other date comparison in the file (`isoToUtcDate`). No local/UTC inconsistency exists.
- **low** — `DateFormat` declares and `parseDate` implements `'MM/DD/YYYY'`, but no shipped profile uses it and no test exercises that branch. Real but dead/unverified, not reachable by any current data path. Route: patch (add one test case covering it; trivial).
- **false** — `SourceProfile.optionalFields` is typed loosely enough to let a profile list `partner_member_id` as optional. Verified in `validate.ts`: the required-field loop hard-codes `partner_member_id` as always-required via `field === 'partner_member_id' || required.has(field)`, independent of `optionalFields`. No bad outcome is reachable — the described misconfiguration is already neutralized by existing code.
- **low** — HTTP lookup doesn't distinguish an unknown `partner_id` from a genuine member miss; both return the same generic 404. The spec's I/O matrix only requires "not-found is a clean response, not a crash," which this satisfies. Distinguishing partner-validity is an enhancement beyond the spec's stated contract, and the fix (an added partner-registry guard) is more than a trivial correction. Reject.
- **low** — No test exercises CLI failure/usage paths (missing file, unknown partner, missing `--partner` flag). Folded into the cli.ts error-handling patch above rather than treated separately.
- **medium** — `src/csv/reader.ts` never validates that a profile's `columnMap` values actually appear in the parsed CSV header row. A mismatched profile/file pairing (wrong profile selected, or a stale/typo'd columnMap) silently turns every mapped field into `undefined`, producing a wall of generic "missing required field" rejections instead of a clear configuration error — undermines the genericity/onboarding story the README advertises. Verified by reading `readCsv`'s mapping loop, which has no header-presence check. Route: patch (validate mapped columns exist in the parsed header; throw a clear error naming what's missing).
- **low** — README's "Known limitations" section omits the csv-parse crash risk and the HTTP partner-validation gap. No separate action: resolved once the underlying issues are patched (or re-noted if anything remains true afterward).
- **low, defer** — `memberIdentity`/`identityKey` in `src/domain/member.ts` are advertised (module docstring + README) as the canonical place identity is computed, but `SqliteStore` and the importer's duplicate-detection both reimplement the identity match inline instead of calling them. Verified: zero call sites of either function outside their own definitions. Nothing is broken today since both inline implementations agree with what `memberIdentity` would produce; this is a design-consistency risk (future changes to identity semantics could silently diverge) rather than a current defect. Defer — refactor, not required to ship this diff correctly.
- **medium** — `src/http/server.ts`'s `main()` constructs `new SqliteStore(dbPath)` without first calling `mkdirSync` on its directory (unlike `cli.ts`, which does). Running `npm run serve` before any import has created the `data/` directory (or against a custom `MEMBERS_DB_PATH` whose directory doesn't exist) crashes at startup. Route: patch (mirror cli.ts's `mkdirSync`).
- **low** — `PORT` env var, if non-numeric, becomes `NaN` and crashes `server.listen()`. The spec explicitly scopes the HTTP server to "what the lookup interface needs for a local demo," and env-var hardening for a misconfiguration no instructions call for is beyond that. Reject as out of scope.
- **medium** — `src/http/server.ts`'s `server.listen()` has no `'error'` event handler, so a common failure (port already in use) crashes the process with an unhandled exception instead of a clean message. This is a realistic local-dev scenario (re-running `npm run serve` without the previous instance having exited). Route: patch (add a `server.on('error', ...)` handler).
- **low** — Only `SIGINT` is handled for graceful shutdown, not `SIGTERM`. `SIGTERM` handling is a process-manager/deployment concern, outside the spec's explicit "local demo" scope for the HTTP server. Reject as out of scope.
- **low** — `isRealCalendarDate`/`parseDate` use `Date.UTC(year, month-1, day)`, which per the ECMA spec maps a year in `0-99` to `1900+year`. Verified: `Date.UTC(99, 0, 1)` round-trips to year `1999`, not `99`. A 4-digit date string with year `0099` would therefore be wrongly rejected as invalid. Real but essentially unreachable for DOB/policy dates in this domain; fix is a trivial one-line swap (`setUTCFullYear` instead of `Date.UTC`). Route: patch, bundled with the other trivial fixes.

## Design Notes

Multi-client is the headline requirement, so the design centres on a **canonical member model** plus a **source profile** per partner that declares how that partner's raw CSV maps onto the canonical model (column names, date format, which fields are required, how to derive identity). The core pipeline only ever sees canonical records; partner differences are data, not code.

## Verification

**Commands:**
- `npm test` -- expected: all tests pass (idempotency, update-on-change, rejection, lookup, identity)
- `npm run build` (tsc) -- expected: no type errors
- `npm run import -- <file> --partner <id>` then re-run -- expected: second run reports 0 new, 0 updated

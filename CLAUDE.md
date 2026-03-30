# CLAUDE.md

## Project Overview

`micropub-express` is an Express 4.x middleware implementing the [Micropub](https://www.w3.org/TR/micropub/) protocol. It handles authentication via IndieAuth token endpoints, parses form-encoded/JSON/multipart Micropub requests, and delegates to user-provided handler functions.

## Architecture

- **`index.js`** — Express router setup, middleware chain (body parsing, token validation, request handling)
- **`lib/core.js`** — Framework-agnostic utilities: body parsing (`processFormEncodedBody`, `processJsonEncodedBody`), file processing, query string encoding, shared types/constants
- **`lib/token.js`** — Token validation against IndieAuth endpoints (`matchAnyTokenReference`, `validateToken`)
- **`test/helpers.js`** — Shared test utilities (`parseQueryString`)
- **`test/micropub.spec.js`** — Unit tests for parsing functions
- **`test/integration/micropub.spec.js`** — Integration tests with Express app, nock-mocked token endpoints

## Tech Stack

- **Runtime**: Node.js ^20.19.0 || ^22.13.0 || >=24
- **Module system**: ESM (`"type": "module"`)
- **Types**: JSDoc annotations checked by TypeScript (`@ts-check`, no compiled TS)
- **Test runner**: `node:test` + `node:assert/strict` (not Mocha/Chai)
- **Mocking**: `node:test` `mock` module (not Sinon)
- **HTTP mocking**: `nock`
- **HTTP testing**: `supertest`
- **Coverage**: `c8`
- **Linter**: ESLint 9 flat config via `@voxpelli/eslint-config`
- **Type checking**: TypeScript via `@voxpelli/tsconfig/node20.json` (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)
- **Script runner**: `npm-run-all2` (not `npm-run-all`) — provides `run-s` (sequential) and `run-p` (parallel)

## Key Commands

```bash
npm test              # Full pipeline: clean, check (lint + tsc + knip + type-coverage), test
npm run check         # Lint + type check + knip + type-coverage (no tests)
npm run test:node     # Just tests with coverage: c8 node --test 'test/**/*.spec.js'
npm run build         # Generate .d.ts declaration files
npx eslint --report-unused-disable-directives .   # Lint only
npx tsc --noEmit      # Type check only
npx knip              # Dead code detection
npx type-coverage --detail --strict --at-least 90 --ignore-files 'test/**/*'  # Type coverage
```

## Quality Gates (all must pass for `npm test` to succeed)

1. **ESLint**: 0 errors, 0 warnings (warnings are errors in CI)
2. **TypeScript**: `tsc --noEmit` — 0 errors
3. **Knip**: No unused exports/dependencies
4. **Type coverage**: >= 90% strict coverage (excluding test files)
5. **Tests**: 45/45 passing
6. **installed-check**: All deps properly declared (ignores eslint via `-i eslint`)

## Editor & Formatting

- **EditorConfig**: 2-space indent, LF line endings, UTF-8, trailing whitespace trimmed, final newline inserted
- **No lockfile**: `.npmrc` sets `package-lock=false` — this is a library, not an app

## Code Conventions

- **JSDoc for types** — no `.ts` files; use `/** @type {X} */` and `@param`/`@returns` in JSDoc blocks
- **Typed locals for `req.body`** — Express types `body` as `any`; always extract into a typed local: `/** @type {ParsedMicropubStructure} */ const body = req.body;`
- **Async IIFE pattern** — Express 4.x doesn't support async middleware; use `(async () => { ... })().catch(err => next(new Error('...', { cause: err })))` with eslint-disable comments for `no-floating-promises` and `promise/prefer-await-to-then`
- **`Object.keys(x).length`** — Use this idiom for checking if an object is empty/non-empty (not `Object.getOwnPropertyNames`)
- **Shared constants** — `mediaTypes`, `reservedProperties`, `requiredScope` are in `lib/core.js`; don't duplicate
- **Trailing commas** — Always use trailing commas in multi-line objects/arrays (enforced by linter via neostandard)
- **`@ts-expect-error`** over `@ts-ignore` — Use with a descriptive comment for intentional type suppressions
- **No `node:querystring`** — Deprecated; use `URLSearchParams` instead (see `test/helpers.js` for multi-value parsing)
- **Unused variables** — Prefix with `_` (e.g., `_req`) to satisfy `no-unused-vars` rule

## Test Patterns

- **nock setup**: `nock.disableNetConnect()` in `before`, `nock.enableNetConnect('127.0.0.1')` to allow supertest
- **nock teardown**: `nock.cleanAll()` in `afterEach`, `nock.enableNetConnect()` in `after`
- **supertest**: Use `supertest.agent(app)` for persistent agent, then `agent.post('/micropub').send(...)`
- **Mocking**: `mock.fn()` from `node:test` mock module; `mock.restoreAll()` in `afterEach`
- **Shared helpers**: `parseQueryString` in `test/helpers.js` — handles multi-value params via `URLSearchParams`

## Dependency Notes

- **`body-parser@^2`** — Intentionally v2 (not Express built-in v1); `req.body` is `undefined` for empty bodies in v2
- **`multer@1.4.4-lts.1`** — Community LTS fork; the `MulterFile` typedef in core.js extends it with `{ truncated?: boolean }`
- **`@types/express@^4`** — Must match `express@^4` runtime; do NOT upgrade to `@types/express@^5`
- **`createRequire` for package.json** — Idiomatic ESM approach for JSON imports; runs once at startup
- **`type-fest`** — Used for `JsonValue` type in parsed Micropub structures
- **`bunyan-adaptor`** — Provides `BunyanLite` interface for lightweight logging; lazy-initialized singleton in `index.js`

## CI / Workflows

- **`.github/workflows/nodejs.yml`** — Tests on Node 20, 22, 24 via `voxpelli/ghatemplates`
- **`.github/workflows/lint.yml`** — Linting via `voxpelli/ghatemplates`
- **`.github/workflows/codeql-analysis.yml`** — CodeQL security scanning

## Versioning and Releases

- **Do NOT manually bump version in `package.json`** — version increases are handled by a release-please workflow
- **Do NOT manually edit `CHANGELOG.md` for releases** — release-please generates changelog entries from conventional commits
- The `CHANGELOG.md` currently has a manually-written `## 1.0.0` section documenting the ESM migration; this will be reconciled when the release workflow runs

## Package Publishing

- **`"files"` in package.json** controls what's published: `index.js`, `index.d.ts`, `index.d.ts.map`, `lib/**/*.js`, `lib/**/*.d.ts`, `lib/**/*.d.ts.map`
- **Declaration files** are generated via `npm run build` (`tsc -p declaration.tsconfig.json`); `npm run clean` removes stale `.d.ts` files
- **Exports map**: `"."` → `./index.js`, `"./core"` → `./lib/core.js`
- **Build pipeline**: `clean` → `build:1-declaration` → `prepublishOnly` triggers full build before publish

## ESLint Config Details

- Based on `@voxpelli/eslint-config` v23 which uses `neostandard` as its foundation
- Config in `eslint.config.js` passes `{ noMocha: true }` since tests use `node:test`
- Existing `eslint-disable` comments in `index.js` are intentional for the async IIFE pattern:
  - `eslint-disable-next-line no-floating-promises` — the IIFE `.catch()` handles errors
  - `eslint-disable-next-line promise/prefer-await-to-then` — `.catch()` is needed for Express error forwarding

## Type Coverage Notes

- `--ignore-nested` flag means nested generics like `Promise<any>` count as typed (only the outer type matters)
- `--strict` mode counts `any` as untyped
- Test files excluded via `--ignore-files 'test/**/*'`
- Current threshold: 90%

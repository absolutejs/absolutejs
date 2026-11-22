# Contributing

Pull requests and issues are welcome — a plugin, a framework adapter, a docs
fix, or a bug you hit. This file is about the mechanics: what to run before you
open a PR, and the two things about this repository that surprise people.

## Getting set up

```bash
bun install
bun run dev        # the example app, every framework, at http://localhost:3000
```

Bun **1.4.4 or newer** is required (`engines` in `package.json`). React Fast
Refresh needs a patched Bun build, because stock Bun ignores
`reactFastRefresh` on `Bun.Transpiler` ([oven-sh/bun#32919]) —
`absolute bun-patch install` fetches it, and everything else works without it.

[oven-sh/bun#32919]: https://github.com/oven-sh/bun/issues/32919

## Before opening a pull request

Run these four, in this order, and let each one pass:

```bash
bun run format      # Bun's formatter (Prettier 3.9 semantics)
bun run lint        # ESLint, with this project's own rules
bun run typecheck   # every framework's checker, plus manifest keys and route() paths
bun test            # unit, then integration
```

A few notes that save time:

- **`bun run format`, not `bunx prettier`.** `absolute fmt` wraps Bun's
  formatter; a separately installed Prettier is a different version and will
  reformat lines you did not touch.
- **Check gates by their exit code.** `absolute typecheck` prints diagnostics
  as `<error code="TS…">`, so grepping its output for `error TS` reads a
  failing run as clean.
- **`src/build/` is not linted** (it is in ESLint's ignore list), so run
  `bun run lint` over the whole project rather than trusting a per-file run
  there.
- **Unit tests must not depend on `dist/`.** CI runs the unit job _before_ the
  build, so a test that reads a built file passes locally and fails there with
  `Cannot find module`. Reproduce the CI condition with
  `mv dist dist.bak && bun run test:unit && mv dist.bak dist`.
- Integration tests that drive a browser need a Chromium and
  `ABSOLUTE_TEST_BROWSER_CDP`; without them those suites fail on a missing
  executable rather than on an assertion.

## Every user-visible change needs a changelog entry

This repository generates `CHANGELOG.md` from entry files, and a gate compares
the entries against the package's published type surface. A PR that changes the
API without an entry fails `bun run check:package`.

Add one file under `changelog/unreleased/`:

```ts
import type { Change } from '@absolutejs/changelog';
import type * as Api from '../../src/index';

export const change: Change<typeof Api> = {
	detail: 'What was wrong, what changed, and why it was done this way.',
	kind: 'fixed',
	summary: 'One line, in the present tense'
};
```

- `kind` is one of `breaking`, `removed`, `added`, `changed`, `deprecated`,
  `fixed`, `security`, `internal`.
- Add `symbols: ['theExport']` when the change touches an exported name — the
  gate asks for it, and names the symbol it wants.
- Add `migration` when a project has to change its own code. If the migration
  is mechanical, `absolute upgrade` will apply it for people; if it is not, the
  instruction is what they read.
- `bunx absolute-changelog check` validates, and `release` cuts the version.
  A maintainer runs `release`; a contributor only needs the entry.

A test-only or docs-only change needs no entry, and the gate will say so.

## Pull requests

CI runs format, lint, and the unit/build/type gate on every PR. The integration
battery — real servers, real browsers, the HMR suite — runs on a schedule and
on demand, because it takes considerably longer.

Two maintainers release from `main` independently, which has one practical
consequence for you: if your branch and `main` both cut a release, the
generated `CHANGELOG.md`, `changelog.json` and `package.json` version will
conflict. Resolving it is mechanical — take `main`'s generated files, re-add
your entry under `changelog/unreleased/`, and the next `release` renumbers your
change on top. Nothing is lost; the conflict is only ever the generated files.

## Reporting things

- **A bug:** open an issue. The templates ask for the version
  (`absolute --version`), which framework, and whether it reproduces in the
  example app.
- **A question or an idea:** GitHub Discussions.
- **A security problem:** do not open an issue. See
  [`SECURITY.md`](./SECURITY.md).

## Code of conduct

Participation is covered by [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

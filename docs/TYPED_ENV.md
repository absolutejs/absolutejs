# Typed environment variables

Declare what the app needs, get a typed object, and fail at startup rather
than at the first request.

```ts
// src/env.ts
import { Type } from '@sinclair/typebox';
import { defineEnv } from '@absolutejs/absolute';

export const env = defineEnv({
	DATABASE_URL: Type.String({ format: 'uri' }),
	LOG_LEVEL: Type.Union([Type.Literal('debug'), Type.Literal('info')], {
		default: 'info'
	}),
	PORT: Type.Number({ default: 3000 })
});
```

`env.PORT` is a `number`, `env.LOG_LEVEL` is `'debug' | 'info'`, and a
typo is a type error. Everything arrives from the environment as a string,
so a schema asking for a number coerces; a default fills in for a variable
that is not set.

A missing or wrong variable stops the process with a table rather than a
stack trace:

```
Environment validation failed:
  ✗ DATABASE_URL — required but not set
  ✓ LOG_LEVEL — "info"
  ✗ PORT — Expected number, got "notanumber"
```

A variable whose name looks like a secret (`SECRET`, `KEY`, `TOKEN`,
`PASSWORD`) is reported as `set` rather than printed, so the summary never
becomes the place a credential leaks.

## What changed

`defineEnv` existed, exported, with **no caller, no test and no mention
anywhere** in the repo or its docs. Two things were wrong with it in
practice.

**A string format could never pass.** TypeBox ships no format validators —
`FormatRegistry` starts empty and a schema naming a format it does not
hold fails closed — so the obvious way to declare a database URL rejected
every value, including correct ones:

```
✗ DATABASE_URL — Unknown format 'uri', got "postgres://user:pw@localhost:5432/db"
```

An app written that way could not start at all, and the message blamed the
value. The formats below are registered now.

**`absolute env` could not see the schema.** It knew one thing: a regex
for `getEnv('X')`. A project declaring its environment the typed way got
`No getEnv() usage found under src/.` — so the command said nothing at all
precisely for the projects doing it the recommended way.

## `absolute env`

```
declared in src/env.ts
  ✗ DATABASE_URL  string (uri)      missing
  ✓ LOG_LEVEL     "debug" | "info"  default "info"
  ✓ PORT          number            default 3000

3 declared · 1 unsatisfied

read with getEnv(), not declared
  ✗ STRIPE_SECRET  missing  1 file

1 referenced · 1 missing
```

Both sources, labelled, because they answer different questions. The
schema says what the project **declares** — with a type, a default and
whether it is optional. The scan says where a variable is **read**. A key
in the scan and not the schema is usually one that should be declared.

`--check` exits 1 when anything is unsatisfied, which includes a variable
that is set to the wrong thing:

```
✗ PORT  number  invalid "notanumber"
```

Presence is the easy half; that second half is the one worth running in
CI.

`--json` prints the same information. `--file path/to/env.ts` reads a
module somewhere other than the conventional locations (`src/env.ts`,
`src/env/index.ts`, `env.ts`).

## Registered formats

`date-time`, `duration`, `email`, `hostname`, `ipv4`, `ipv6`, `uri`,
`uri-reference`, `url`, `uuid`.

These are deliberately simple checks rather than full grammars. A format
here answers "did someone paste the wrong *kind* of thing into this
variable" — a bare word where a URL goes — which is what a startup check
is for. A variable needing a precise grammar should carry a `pattern`,
which TypeBox has always enforced itself.

**`uri` means absolute**, as it does in JSON Schema. The first version of
this accepted relative references too, by falling back to parsing against
a base — which made the format validate **nothing**, because every string
is a legal relative path, `"not a uri at all"` included. Relative lives
under `uri-reference`, where a reader can see the difference. A format
that passes everything is worse than no format, since it reads like a
constraint.

A format your project registers itself is left alone.

## How a tool reads the schema

`defineEnv` validates when its module is imported and throws when a
variable is missing — right for a server, and impossible for a command
whose job is to say *which* variables are missing. Importing the module to
read the schema would throw before printing anything.

So the CLI sets `ABSOLUTE_ENV_INSPECT` around the import. In that mode
`defineEnv` records its properties and returns a schema-shaped placeholder
instead of validating, so a module that reads a variable while being
imported still evaluates. The alternative was asking projects to export
the schema separately from the call that consumes it — two things nobody
would keep in step.

The placeholders are built from the schema rather than with TypeBox's
`Value.Create`, which refuses a formatted string that has no default
("String types with formats must specify a default value") — so inspection
would have failed on exactly the `format: 'uri'` case the format registry
exists for.

## `.env` and git

If `.env` holds a variable whose name looks like a secret and `.env` is
not listed in `.gitignore`, `defineEnv` warns once at startup.

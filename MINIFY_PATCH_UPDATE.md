# AbsoluteJS Bun Build Options Update

Hey Eugene,

We fixed the underlying issue that came up from the minify problem. The
problem was not just that `minify` was hardcoded; AbsoluteJS was hardcoding
all of its `Bun.build()` settings with no supported way for an app to
override them.

Published beta:

```txt
@absolutejs/absolute@0.19.0-beta.765
```

## What Changed

Absolute now supports a `bunBuild` config field. It lets you pass through
allowed Bun `BuildConfig` options globally or per build pass.

This means `minify` can be customized, but the API is broader than minify.
It also supports other Bun build options like `sourcemap`, `drop`,
`ignoreDCEAnnotations`, `loader`, `conditions`, `env`, `banner`, `footer`,
`metafile`, `splitting`, `naming`, and `tsconfig`.

We intentionally do not allow options that would break Absolute's build
contract, such as `entrypoints`, `outdir`, `root`, `target`, `format`,
`throw`, or `compile`.

## Single-Service Config Shape

If your `absolute.config.ts` is a normal single-service config, put
`bunBuild` at the root:

```ts
import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	entry: 'src/backend/server.ts',
	reactDirectory: 'src/react',
	bunBuild: {
		reactClient: {
			minify: {
				whitespace: true,
				syntax: true,
				identifiers: false
			}
		},
		nonReactClient: {
			minify: {
				whitespace: true,
				syntax: true,
				identifiers: false
			}
		},
		islandClient: {
			minify: {
				whitespace: true,
				syntax: true,
				identifiers: false
			}
		}
	}
});
```

## Multi-Service Config Shape

If your config has multiple named services, put `bunBuild` inside the
Absolute service that needs it:

```ts
import { defineConfig } from '@absolutejs/absolute';

export default defineConfig({
	app: {
		entry: 'src/backend/server.ts',
		reactDirectory: 'src/react',
		bunBuild: {
			reactClient: {
				minify: {
					whitespace: true,
					syntax: true,
					identifiers: false
				}
			}
		}
	},
	worker: {
		kind: 'command',
		command: ['bun', 'run', 'worker.ts']
	}
});
```

## Applying One Option To Every Build Pass

You can also use the shorthand form. This applies the option as the default
for all Absolute Bun build passes:

```ts
export default defineConfig({
	entry: 'src/backend/server.ts',
	reactDirectory: 'src/react',
	bunBuild: {
		sourcemap: 'linked'
	}
});
```

## Per-Pass Overrides

For different settings on different build passes, use `default` plus
specific pass keys:

```ts
export default defineConfig({
	entry: 'src/backend/server.ts',
	reactDirectory: 'src/react',
	bunBuild: {
		default: {
			sourcemap: 'linked'
		},
		reactClient: {
			minify: false
		},
		nonReactClient: {
			minify: {
				whitespace: true,
				syntax: true,
				identifiers: false
			}
		}
	}
});
```

Supported pass keys:

```txt
server
reactClient
nonReactClient
islandClient
globalCss
vueCss
```

## Notes

The minifier issue itself is still an upstream Bun behavior. The AbsoluteJS
change is that projects now have a supported escape hatch to configure Bun
build behavior without patching `node_modules` or waiting for a framework
release for each individual Bun build option.

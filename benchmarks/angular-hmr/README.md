# Angular HMR benchmark

Reproducible measurements of AbsoluteJS Angular HMR latency for the
five common edit shapes. Used to populate the table in
`ABSOLUTEJS_ANGULAR_HMR.md`.

## Project shape

Three standalone Angular components on `@absolutejs/absolute@0.19.0-beta.915`
+ `@angular/* 21.2.11`:

- `BenchPage` — root page (templateUrl)
- `HeaderComponent` — inline-template component
- `CounterComponent` — templateUrl + styleUrl + `@Input`

## Running

```bash
cd benchmarks/angular-hmr
bun install
bun run dev    # starts dev server on :4321, tees to dev.log
# in a second shell:
bun run bench  # connects to ws://localhost:4321/hmr, runs N=30 per case
```

`bun run bench` performs scripted text replacements on each fixture
file (alternating apply/revert), waits for the matching HMR
broadcast on the WebSocket, and parses the dev server's own
`[ng-hmr]` / `[hmr] css update` log line for the server-side
breakdown. Originals are restored on exit (and on SIGINT).

## Cases

| # | Edit shape | Tier | Expected WS broadcast |
|---|---|---|---|
| 1 | TS method body                     | 0   | `angular:component-update` |
| 2 | Inline template literal            | 0   | `angular:component-update` |
| 3 | External `templateUrl` `.html`     | 0   | `angular:component-update` |
| 4 | External `styleUrl` `.css`         | css | `style-update` (framework CSS HMR) |
| 5 | Add `@Input` (structural change)   | 1a  | `angular:component-remount` |

## Output shape

Each case prints both end-to-end (file write → WS broadcast received)
and server-side (parsed from `[ng-hmr]` log) min/p50/mean/p95/max.
End-to-end includes file-watcher debounce + WS roundtrip;
server-side is just the dispatch cost.

## Knobs

Environment variables, all optional:

- `HMR_BENCH_N` — sample count per case (default: 30)
- `HMR_BENCH_WARMUP` — warmup iterations (default: 3)
- `HMR_BENCH_TIMEOUT_MS` — per-iteration timeout (default: 15000)
- `HMR_BENCH_WS_URL` — dev server WS URL (default: `ws://localhost:4321/hmr`)
- `HMR_BENCH_DEV_LOG` — dev log path (default: `./dev.log`)

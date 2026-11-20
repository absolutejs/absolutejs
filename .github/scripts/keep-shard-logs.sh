#!/usr/bin/env bash
# File the shard runner's logs under a name, so one run cannot overwrite
# another's.
#
# `scripts/shardedTests.ts` always writes `.test-shards/shard-0.log`,
# `shard-1.log`, `exclusive-N.log`. The nightly runs it once per directory,
# so every directory overwrote the last one's logs: the first failing run
# uploaded an artifact holding only the final, passing directory, and the
# failures it was meant to explain were gone. The job console shows just
# each shard's pass/fail tally, so those files are the only place the
# assertion text exists.
#
# Usage: keep-shard-logs.sh <name>
set -euo pipefail

name="${1:?usage: keep-shard-logs.sh <name>}"
destination="${RUNNER_TEMP:-/tmp}/shard-logs/${name}"

shopt -s nullglob
logs=(.test-shards/*.log)
if [ ${#logs[@]} -eq 0 ]; then
	echo "keep-shard-logs: no logs in .test-shards for ${name}"
	exit 0
fi

mkdir -p "$destination"
cp "${logs[@]}" "$destination/"
echo "keep-shard-logs: kept ${#logs[@]} file(s) for ${name}"

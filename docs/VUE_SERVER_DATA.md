# Vue server data: `useServerData`

`useServerData(key, fetcher, options?)` loads data while a Vue page renders on
the server and sends it to the browser with the page. Hydration reads the value
from the page instead of fetching again. It fills the gap Nuxt's `useAsyncData`
fills: before it, server data for a Vue page had to come from the Elysia route
handler as props.

```vue
<script setup lang="ts">
import { useServerData } from '@absolutejs/absolute/vue';

type Profile = { id: number; name: string };

const loadProfile = async (signal: AbortSignal): Promise<Profile> => {
	const response = await fetch('https://api.example.com/me', { signal });

	return response.json();
};

const { data, error, pending, refresh } = useServerData('profile', loadProfile);
</script>

<template>
	<p v-if="pending">Loading…</p>
	<p v-else-if="error">Could not load your profile: {{ error.message }}</p>
	<h1 v-else-if="data">{{ data.name }}</h1>
	<button type="button" @click="refresh">Reload</button>
</template>
```

## What it returns

| Ref       | Type                  | Meaning                                                    |
| --------- | --------------------- | ---------------------------------------------------------- |
| `data`    | `Ref<T \| null>`      | The loaded value. `T` is the fetcher's resolved type.       |
| `error`   | `Ref<Error \| null>`  | The last failure, on the server or in the browser.         |
| `pending` | `Ref<boolean>`        | True while a load is in flight.                            |
| `refresh` | `() => Promise<void>` | Loads again in the browser, aborting a load in flight.     |

The fetcher receives an `AbortSignal`. In the browser it aborts when the
component unmounts or `refresh()` starts a new load.

## When the fetcher runs

| Situation                                                  | Server       | Browser                      |
| ---------------------------------------------------------- | ------------ | ---------------------------- |
| First load of a hydrated page                              | runs once    | reads the page, no fetch     |
| Client-side route change to a component that uses it       | —            | runs                         |
| The same component mounting again (route back, HMR remount) | —           | runs (the page value is used once) |
| `client: 'none'` page                                      | runs once    | no client code; nothing is written into the page |
| `server: false`                                            | skipped, renders `pending` | runs                |
| Page that exports `routes` (SPA shell)                     | skipped (the shell is not server-rendered) | runs |
| Streaming page (`collectStreamingSlots: true`)             | runs once    | reads the page, no fetch     |

On the server the fetcher runs in Vue's `onServerPrefetch`, so the page renders
with the data already in place.

## Rules

- **Call it in `setup()`** (or `<script setup>`). Calling it elsewhere on the
  server throws.
- **Keys are unique per request.** Two `useServerData` calls with one key in a
  single render fail the page with an error naming the key outside production.
  In production the repeated call logs a warning and loads in the browser. Put
  the component's identity in the key when a component appears more than once
  (`` `post:${props.id}` ``).
- **Results must be JSON-serializable.** Dates arrive as strings, `undefined`
  becomes `null`, and a value JSON can't encode (a cycle, a `BigInt`) becomes
  that key's error state.

## Errors

A fetcher that throws on the server does not fail the page. The component
renders with `error` set, and the browser hydrates with an `Error` of the same
`name`. Outside production the message is the original one; in production it
is replaced with `Loading server data failed.` so server details don't reach
the page. The original error is logged on the server.

## How the data reaches the page

The Vue page handler puts a per-request collector on the SSR context. After
rendering, it writes the collected values into one inline script before the
page's module script:

```html
<script>window.__ABSOLUTE_SERVER_DATA__={"profile":{"data":{"id":1,"name":"Ada"}}}</script>
```

The JSON is escaped (`<`, U+2028 and U+2029 become `\u` escapes), so a value
can't close the script element or inject markup. The script is built in one
helper, `serializeServerDataScript` in `src/vue/serverDataPayload.ts`, which is
where attributes such as a CSP nonce belong. A page that loaded no server data
gets no script.

The package ships two builds of the composable: the server build
(`@absolutejs/absolute/vue` under the `import` condition) collects data, and the
browser build (`browser` condition) reads `window.__ABSOLUTE_SERVER_DATA__`,
deleting each entry as it reads it.

Vue islands rendered outside a Vue page have no collector, so the server
renders their pending state and the browser loads the data.

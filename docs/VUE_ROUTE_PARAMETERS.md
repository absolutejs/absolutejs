# Route parameters during navigation

Use `getRouteParam` for a one-time read or `useRouteParam` for a reactive read:

```ts
import { useRoute } from 'vue-router';
import { useRouteParam } from '@absolutejs/absolute/vue';
import { watch } from 'vue';

const route = useRoute();
const matchId = useRouteParam(() => route.params.matchId);

watch(matchId, async (id, _previous, onCleanup) => {
  if (id === undefined) return;
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  // Handle request failures normally; ignore cancellation after navigation.
  try {
    const response = await fetch(`/api/matches/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const match = await response.json();
    if (!controller.signal.aborted) console.log(match);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  }
}, { immediate: true });
```

Both helpers return `string | undefined`. Strings, including empty strings, are
preserved; arrays return their first element; missing values, null and empty
arrays return undefined. These helpers do not validate an ID or authorize access.
Use the complete original array when all repeated segments are meaningful.

`useRouteParam` takes a getter rather than a captured value or router import. It
tracks the application's own Vue Router and avoids introducing another router
instance or injection symbols. It does not preserve a previous route's value.

The reactive route changes before an outgoing component finishes unmounting.
Even a required parameter may therefore become absent while a synchronous watcher
is still alive. Cancel or invalidate pending work when the parameter changes, and
check ownership before applying late results. The helper makes absence explicit;
it does not cancel application requests itself.

New create-absolutejs projects enable `noUncheckedIndexedAccess`. Existing projects
can opt in by adding it to `compilerOptions` in tsconfig.json, then fixing reported
array and dictionary accesses. `strict` alone does not enable this check. Do not
silence these errors with non-null assertions: handle missing values or establish
a runtime invariant. Direct `useRoute()` reads remain subject to Vue Router's
record types; the helper's optional result is retained even without that flag.

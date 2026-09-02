# Transactional mobile navigation

AbsoluteJS treats a native-shell route change as a transaction. Application
routes and links remain ordinary AbsoluteJS routes; authors do not manage an
AbortController, history index, or framework disposal hook.

## Guarantees

- A new navigation aborts an older page-data request. Only the latest completed
  request may enter the document commit queue.
- Page disposal and activation are serialized across React, Angular, Vue,
  Svelte, HTML, and HTMX. Two framework roots never mutate the shell document at
  the same time.
- Push or replace history is written only after the destination activates.
- A failed or offline page-data request leaves the current route interactive and
  presents a retry action. A failed Back/Forward load rolls the browser history
  pointer back to the visible route.
- Back during a pending data request cancels that request before changing route
  history. An open AbsoluteJS sheet still receives Back first.
- Back/Forward restores the route's memory-only form controls, selection, focus,
  disclosure state, window position, and opted-in scroll regions. A newly pushed
  route starts at the top and focuses its semantic heading or main landmark.

The shell marks a request in progress with
`data-absolute-mobile-navigation-pending` and `aria-busy="true"` on `body`.
Applications may style the marker, but should not remove it.

## State and sensitive fields

Route snapshots exist only in the current JavaScript process. AbsoluteJS never
writes form values into `history.state`, local storage, Sync, telemetry, or a
native preference. Password, file, hidden, payment-card, and one-time-code fields
are excluded even from the memory snapshot.

An application can exclude any subtree explicitly:

```html
<form data-absolute-navigation-preserve="off">
  <!-- Values in this subtree reset when the route is recreated. -->
</form>
```

Process death intentionally clears transient form restoration. Durable user data
belongs in application state or `@absolutejs/sync`, where sensitivity,
encryption, principal partitioning, migrations, and conflict policy are explicit.

## Scroll and focus

The framework-neutral `data-absolute-app-main` region participates in scroll
restoration automatically. Additional nested regions opt in with
`data-absolute-scroll-restoration`.

On a new route, AbsoluteJS focuses the first available target in this order:

1. `[data-absolute-navigation-focus]`
2. the first `h1` inside `main`
3. the first document `h1`
4. `main`

An existing `[autofocus]` target wins. Restored history entries return focus to
the previously focused control when that control still exists.

## Capacitor and Expo

Capacitor and Expo WebView routes use the same coordinator. Expo-native
replacement routes retain Expo Router's native stack and cancel their trusted
server data request when a screen unmounts or its route parameters change. The
two renderers therefore share the latest-request-wins rule without pretending a
DOM snapshot can restore React Native component state.

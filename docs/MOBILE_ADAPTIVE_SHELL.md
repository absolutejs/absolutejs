# Mobile adaptive shell

AbsoluteJS installs the adaptive shell automatically in every embedded mobile
page. React, Vue, Svelte, Angular, HTML, and HTMX pages receive the same contract;
page authors do not import a runtime or change their routes.

The shell deliberately does not add safe-area padding to application content.
Doing so would double-pad existing responsive layouts. It publishes environment
state, while only the shell-owned loading/error screen and accessibility
announcer receive built-in styling.

## CSS contract

The following custom properties are maintained on `<html>` and refreshed after
rotation, keyboard changes, native-host changes, and cross-framework navigation:

```css
--absolute-safe-area-inset-top
--absolute-safe-area-inset-right
--absolute-safe-area-inset-bottom
--absolute-safe-area-inset-left
--absolute-keyboard-height
--absolute-viewport-height
--absolute-viewport-width
--absolute-available-height
```

For example, an application shell can opt into native insets without knowing
whether it is running in Capacitor, an Expo WebView, or a browser:

```css
.app-shell {
	min-height: var(--absolute-available-height, 100dvh);
	padding:
		var(--absolute-safe-area-inset-top, 0)
		var(--absolute-safe-area-inset-right, 0)
		var(--absolute-safe-area-inset-bottom, 0)
		var(--absolute-safe-area-inset-left, 0);
}
```

The root also publishes these data attributes:

- `data-absolute-mobile`
- `data-absolute-runtime="capacitor|expo|web|test"`
- `data-absolute-platform="ios|android|..."`
- `data-absolute-form-factor="phone|tablet|desktop|unknown"`
- `data-absolute-keyboard="visible|hidden"`
- `data-absolute-network="online|offline"`
- `data-absolute-connection="wifi|cellular|ethernet|unknown|none"`
- `data-absolute-reduced-motion="reduce|no-preference"`

Advanced framework-neutral code may listen for
`absolute:adaptive-shell-change`. Its `CustomEvent.detail` contains the complete
normalized platform, network, keyboard, viewport, and available-height state.

## Automatic behavior

- `viewport-fit=cover` is retained even when an HTML or HTMX page replaces the
  document head.
- Keyboard and System Bars providers are shell capabilities, so `absolute mobile
  sync` provisions them even when page code never imports those APIs.
- Capacitor uses normalized device state and WebView viewport signals. Expo sends
  safe-area changes from its native host to the same embedded-page contract.
- Native system bars start in automatic appearance and follow the operating
  system. Explicit app calls through `@absolutejs/devices` can still change them.
- Loading, update-required, and navigation-failure screens are accessible live
  regions. Connectivity changes are announced without adding a visual banner to
  author pages.
- Existing responsive sites keep their layout. Only code that opts into the
  published variables or attributes changes its application UI.

The next UI milestone builds optional app-shell, navigation, tab-bar, stack,
sheet, and mobile-aware link primitives on this contract.

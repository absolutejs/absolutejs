# Framework-neutral mobile UI primitives

AbsoluteJS provides an optional mobile application layout layer without making
React, React Native, or a design system part of the page contract. The native
shell installs it automatically for React, Angular, Vue, Svelte, HTML, and HTMX
pages. Authors opt in with attributes on ordinary semantic HTML.

These primitives intentionally own layout mechanics, safe areas, navigation
direction, back behavior, and accessibility. Colors, typography, icons, spacing
tokens, and application branding remain application CSS.

## Complete example

```html
<div data-absolute-app-shell>
	<header data-absolute-app-header>
		<h1>Account</h1>
		<button data-absolute-sheet-open="filters">Filters</button>
	</header>

	<main data-absolute-app-main>
		<section data-absolute-navigation-stack>
			<!-- Existing framework or static page content -->
		</section>
	</main>

	<nav data-absolute-tab-bar aria-label="Primary">
		<a href="/home">Home</a>
		<a href="/account" data-absolute-tab-match="prefix">Account</a>
	</nav>

	<dialog
		id="filters"
		data-absolute-sheet
		aria-labelledby="filters-title"
	>
		<h2 id="filters-title">Filters</h2>
		<button data-absolute-sheet-close>Done</button>
	</dialog>
</div>
```

This is valid JSX and template markup too. There are no custom elements, so
Angular does not need `CUSTOM_ELEMENTS_SCHEMA`, SSR does not emit unknown
elements, and a disabled or failed enhancement still leaves usable HTML.

## Attribute contract

| Attribute | Element | Behavior |
| --- | --- | --- |
| `data-absolute-app-shell` | layout container | Full available-height grid using the adaptive-shell safe-area contract |
| `data-absolute-app-header` | header region | Applies the top safe area |
| `data-absolute-app-main` | main region | Creates the bounded scrolling region without body-scroll assumptions |
| `data-absolute-navigation-stack` | route view | Participates in forward/back View Transitions when supported |
| `data-absolute-tab-bar` | `nav` | Applies the bottom safe area and synchronizes `aria-current="page"` |
| `data-absolute-tab-match="prefix"` | tab-bar `a` | Keeps a tab active for its nested routes; exact matching is the default |
| `data-absolute-sheet` | `dialog` | Accessible bottom sheet with modal focus and safe-area handling |
| `data-absolute-sheet-open="id"` | button or link | Opens the named sheet and remembers its focus origin |
| `data-absolute-sheet-close` | control inside a sheet | Closes the containing sheet and restores focus |
| `data-absolute-link` | `a` | Normal forward navigation with native-shell enhancement |
| `data-absolute-link="replace"` | `a` | Replaces the current mobile history entry |
| `data-absolute-link="back"` | `a` | Closes an open sheet first, then uses native/browser history; `href` remains the no-JS fallback |
| `data-absolute-link="external"` | `a` | Uses the Capacitor system browser or Expo host; ordinary web navigation remains the fallback |

Tab bars remain navigation landmarks and links remain anchors. AbsoluteJS does
not apply ARIA `tablist`/`tab` roles because those roles describe in-document
tabs, not route navigation.

## Sheet and back behavior

Sheets use the platform `<dialog>` primitive. A close control, Escape/cancel,
backdrop click, Android Back, and a `data-absolute-link="back"` request all close
the active sheet before route history changes. Only one AbsoluteJS sheet can be
open at a time. Focus moves into the sheet on open and returns to its opener on
close.

Android Back is coordinated at the shell boundary:

1. An open sheet receives the request first.
2. Otherwise the embedded route history goes back.
3. At the root, Capacitor or the Expo host exits according to Android behavior.

## Navigation and events

The shell records `forward`, `back`, or `replace` on
`data-absolute-navigation-direction` and emits
`absolute:navigation-change` after the new route activates. Event detail is:

```ts
type AbsoluteMobileNavigationDetail = {
	direction: 'back' | 'forward' | 'replace';
	from: string;
	to: string;
};
```

Opening or closing a sheet emits `absolute:sheet-change` with `{ id, open }`.
Advanced code can call `requestAbsoluteMobileBack()`; a `true` result means a UI
layer consumed the request.

## Browser-only installation

An AbsoluteJS native shell installs and restores the primitives automatically,
including after an HTML or HTMX document replacement. A normal browser-only
site can opt in from any client entry:

```ts
import { installAbsoluteMobileUiPrimitives } from '@absolutejs/absolute/mobile/ui';

const mobileUi = installAbsoluteMobileUiPrimitives();
```

The returned controller provides `refreshDocument`, `navigate`, `requestBack`,
and `dispose`. Direct sheet controls are also exported as
`openAbsoluteMobileSheet` and `closeAbsoluteMobileSheet`.

## Expo scope

Expo WebView routes use this exact DOM layer, including safe areas, sheets,
links, and Android Back. Expo-native replacement routes remain real React Native
screens and therefore use native React components rather than pretending DOM
elements can render natively. They share the same server data, route ownership,
deep-link, Auth, Sync, and back-stack contracts. Native visual wrappers can be
added later without changing this semantic-HTML API.

/* The identity marker a third-party script carries, in a module of its
 * own because both sides need it and neither can import the other.
 *
 * `utils/scriptAttributes.ts` writes it when a `<Script>` renders, and
 * `client/navigation.ts` reads it to decide whether an incoming page's
 * script is one the live document has already run. A duplicated string
 * literal would break deduplication silently the first time one of them
 * was renamed — the tag would still render and the script would simply run
 * again on every navigation, which is exactly the bug this closes. */

export const SCRIPT_MARKER = 'data-absolute-script';

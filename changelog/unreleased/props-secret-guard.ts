import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A page's props and an island's props are serialized into the page — `window.__INITIAL_PROPS__` and `data-props` — so anything in them is public. A handler doing `props: { apiKey: getEnv('STRIPE_SECRET_KEY') }` shipped that key to every visitor and nothing looked wrong. Serializing now fails instead when the payload contains the value of an environment variable whose name reads like a secret (CREDENTIAL, KEY, PASSWORD, SECRET, TOKEN), naming the variable and the page, and never the value. The usual guard elsewhere is a naming convention on env references in client code, which bundlers need because they inline process.env.X; Bun does not inline it, so the reference survives and throws in the browser rather than leaking, and a convention on references would not have caught this. Values are what travel, so values are what is checked. Deliberate limits keep it from firing on ordinary content: only sensitive-looking names, only values of twelve characters or more, and a PUBLIC_ prefix exempts a variable, which is how a publishable key says it is meant to be sent. A secret re-encoded on the way through is not found — this catches the accident, not an adversary inside the handler. Wired into all five places that serialize props: the React, Svelte, Vue and Ember page handlers and the island markup.",
	kind: 'security',
	summary: 'A page refuses to serialize a server secret into its props',
	symbols: ['serializeIslandProps']
};

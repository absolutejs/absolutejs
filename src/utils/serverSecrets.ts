/* Refusing to serialize a server secret into a page.
 *
 * Page props and island props are the one path that carries server
 * values into the browser verbatim: they are JSON, written into
 * `window.__INITIAL_PROPS__` or a `data-props` attribute. A handler that
 * does `props: { apiKey: getEnv('STRIPE_SECRET_KEY') }` ships that key to
 * every visitor, and nothing about the code looks wrong.
 *
 * The usual guard elsewhere is a naming convention on env *references* in
 * client code (`NEXT_PUBLIC_`, `VITE_`), which bundlers need because they
 * inline `process.env.X`. Bun does not inline it — a client bundle keeps
 * the reference and throws in the browser — so that convention would not
 * catch this. What travels here is a *value*, so this checks values: if
 * the text about to be serialized contains the value of an env var whose
 * name reads like a secret, the render fails instead.
 *
 * Deliberate limits:
 *
 * - Only env vars whose NAME looks sensitive. A guard over every variable
 *   would fire on a hostname or a port that legitimately reaches a page.
 * - Only values of 12 characters or more. Shorter ones collide with
 *   ordinary content; `KEY=1` would otherwise fail every page.
 * - A `PUBLIC_` prefix exempts a variable, which is how a publishable key
 *   (`PUBLIC_STRIPE_PUBLISHABLE_KEY`) says it is meant to be sent.
 * - A literal substring match. A secret that was re-encoded on the way
 *   through — base64, a hash, URL-escaped — is not found. This catches the
 *   accident, not an adversary inside the handler. */

const SENSITIVE_NAME = /CREDENTIAL|KEY|PASSWORD|SECRET|TOKEN/i;
const PUBLIC_PREFIX = 'PUBLIC_';
const MINIMUM_LENGTH = 12;

type Secret = { name: string; value: string };

let cached: Secret[] | undefined;

const isSensitive = ([name, value]: [string, string | undefined]) =>
	SENSITIVE_NAME.test(name) &&
	!name.startsWith(PUBLIC_PREFIX) &&
	typeof value === 'string' &&
	value.length >= MINIMUM_LENGTH;

/* Read once: the environment does not change under a running server, and
 * this runs on every render. */
const secrets = () => {
	cached ??= Object.entries(process.env)
		.filter(isSensitive)
		.map(([name, value]) => ({ name, value: String(value) }));

	return cached;
};

/** Throws when `serialized` carries a server secret, naming the variable
 *  and never the value — an error message is logged, and a log is not a
 *  place to put a key that just escaped.
 *
 *  `where` names what was being serialized, so the message says which
 *  page or island to look at. */
export const assertNoServerSecrets = (serialized: string, where: string) => {
	const name = findServerSecret(serialized);
	if (!name) return;

	throw new Error(
		`${where} would send the value of ${name} to the browser. Props are serialized into the page, so anything in them is public. Pass only what the page may show; if ${name} is genuinely publishable, rename it with the PUBLIC_ prefix.`
	);
};

/** The name of the first server secret found in `text`, or undefined. */
export const findServerSecret = (text: string) =>
	secrets().find((secret) => text.includes(secret.value))?.name;

/** Forget the snapshot. For tests that change the environment. */
export const resetServerSecretCache = () => {
	cached = undefined;
};

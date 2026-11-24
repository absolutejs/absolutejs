/* The string formats an env schema can use.
 *
 * TypeBox ships no format validators: `FormatRegistry` starts empty, and a
 * schema naming a format it does not hold fails CLOSED. So the most
 * natural way to declare a database URL —
 *
 *   DATABASE_URL: Type.String({ format: 'uri' })
 *
 * — rejected every value, including correct ones, with
 * `Unknown format 'uri', got "postgres://user:pw@localhost:5432/db"`: a
 * message that blames the value and leaves the real cause unsaid. An app
 * written that way could not start at all.
 *
 * These are deliberately simple checks rather than the full grammars. A
 * format here answers "did someone paste the wrong KIND of thing into this
 * variable" — a connection string where a port goes, a bare word where a
 * URL goes — which is what a startup check is for. An env var that needs
 * a precise grammar should carry a `pattern`, which TypeBox has always
 * enforced itself. */

import { FormatRegistry } from '@sinclair/typebox';

const HOSTNAME =
	/^[a-z\d]([a-z\d-]{0,61}[a-z\d])?(\.[a-z\d]([a-z\d-]{0,61}[a-z\d])?)*$/iu;
const EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/u;
const UUID =
	/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u;
const IPV6 = /^[\da-f:]+$/iu;
const DURATION =
	/^P(?!$)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/u;

const isUrl = (value: string) => URL.canParse(value);

const isDuration = (value: string) => DURATION.test(value);

const isEmail = (value: string) => EMAIL.test(value);

const isHostname = (value: string) => HOSTNAME.test(value);

const isIpv6 = (value: string) => IPV6.test(value) && value.includes(':');

const isUuid = (value: string) => UUID.test(value);

/* `uri` is an ABSOLUTE URI, which is what JSON Schema means by it and
 * what an env var almost always wants: a connection string, an issuer, a
 * webhook endpoint.
 *
 * The first version of this accepted a relative one too, by falling back
 * to `URL.canParse(value, base)` — and that made the format validate
 * NOTHING. Measured: with a base, `"not a uri at all"` parses, because it
 * is a legal relative path. A format that passes everything is worse than
 * no format, since it reads like a constraint. Relative lives under
 * `uri-reference`, where a reader can see the difference. */
const isUri = (value: string) => URL.canParse(value);

const isUriReference = (value: string) =>
	URL.canParse(value) || URL.canParse(value, 'https://absolute.invalid');

const isIpv4 = (value: string) => {
	const match = IPV4.exec(value);
	if (match === null) return false;

	return match
		.slice(1)
		.every((part) => part.length < 4 && Number(part) < 256);
};

const isDateTime = (value: string) =>
	!Number.isNaN(Date.parse(value)) && /\d{4}-\d{2}-\d{2}/u.test(value);

/** A value that satisfies each format, for a tool that needs a
 *  schema-shaped placeholder rather than a real environment. Inspection
 *  has to produce one for a variable that is not set, and `Value.Create`
 *  refuses: "String types with formats must specify a default value" — so
 *  a `format: 'uri'` variable, the very case this file exists for, could
 *  not be inspected at all. */
export const ENV_FORMAT_SAMPLES: Record<string, string> = {
	'date-time': '1970-01-01T00:00:00.000Z',
	duration: 'PT0S',
	email: 'nobody@example.invalid',
	hostname: 'example.invalid',
	ipv4: '127.0.0.1',
	ipv6: '::1',
	uri: 'https://example.invalid',
	'uri-reference': '/example',
	url: 'https://example.invalid',
	uuid: '00000000-0000-4000-8000-000000000000'
};

/** The formats registered for an env schema, in the order a reader of a
 *  validation failure would want to see them listed. */
export const ENV_FORMATS: Record<string, (value: string) => boolean> = {
	'date-time': isDateTime,
	duration: isDuration,
	email: isEmail,
	hostname: isHostname,
	ipv4: isIpv4,
	ipv6: isIpv6,
	uri: isUri,
	'uri-reference': isUriReference,
	url: isUrl,
	uuid: isUuid
};

/** Registers them once. Called by `defineEnv`, so a project never has to;
 *  a format the project registered itself is left alone, since its
 *  definition is more likely to be the one it meant. */
export const registerEnvFormats = () => {
	for (const [name, check] of Object.entries(ENV_FORMATS)) {
		if (!FormatRegistry.Has(name)) FormatRegistry.Set(name, check);
	}
};

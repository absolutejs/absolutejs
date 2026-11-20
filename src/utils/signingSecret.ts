import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isProductionRuntime } from './runtimeMode';

/** The framework's symmetric signing key.
 *
 *  Used to sign values the server hands to a browser and must later trust
 *  again without storing anything: a CSRF token's double-submit half, and
 *  the one-shot form-action result cookie. There is no session store to
 *  remember what was issued, so the signature IS the memory.
 *
 *  `ABSOLUTE_SECRET` holds it. In production a missing secret is refused,
 *  rather than quietly replaced with a per-process key: that key would
 *  work in testing and then reject real submissions the moment the
 *  process restarted or a second instance answered — a confusing failure
 *  for the visitor and an invisible one for the operator. In development a
 *  per-process key is generated silently, so nothing has to be configured
 *  to try a form out.
 */

const SECRET_ENV = 'ABSOLUTE_SECRET';
const DEVELOPMENT_SECRET_BYTES = 32;

let developmentSecret: string | undefined;

const missingInProduction = () =>
	new Error(
		`${SECRET_ENV} is not set. Signing a CSRF token or a form-action result cookie needs a secret that survives a restart and is shared by every instance, so production will not fall back to a generated one. Set ${SECRET_ENV} to a long random string (\`openssl rand -hex 32\`), the same value on every instance.`
	);

/** Whether a secret is available without throwing — for a caller that
 *  would rather degrade than fail. */
export const hasSigningSecret = () =>
	Boolean(process.env[SECRET_ENV]) || !isProductionRuntime();

/** The configured secret, or a per-process one in development.
 *
 *  Throws in production when `ABSOLUTE_SECRET` is unset. Only a feature
 *  that signs something calls this, so a project using neither CSRF
 *  tokens nor a signed result cookie never meets it. */
export const signingSecret = () => {
	const configured = process.env[SECRET_ENV];
	if (configured) return configured;
	if (isProductionRuntime()) throw missingInProduction();
	developmentSecret ??= randomBytes(DEVELOPMENT_SECRET_BYTES).toString('hex');

	return developmentSecret;
};

/** `value` signed with `secret`, as url-safe base64.
 *
 *  `purpose` keeps one feature's signatures from being replayed into
 *  another: a result cookie's signature cannot stand in for a CSRF
 *  token's, even though both use this key. */
export const signValue = (purpose: string, value: string, secret: string) =>
	createHmac('sha256', secret)
		.update(`${purpose}:${value}`)
		.digest('base64url');

/** Whether `signature` is this server's signature over `value` for
 *  `purpose`.
 *
 *  Compared in constant time, so a near-miss reveals nothing about how
 *  much of the signature was right. Lengths are checked first because
 *  `timingSafeEqual` throws on a mismatch. */
export const verifyValue = (
	purpose: string,
	value: string,
	signature: string,
	secret: string
) => {
	const expected = Buffer.from(signValue(purpose, value, secret));
	const given = Buffer.from(signature);

	return expected.length === given.length && timingSafeEqual(expected, given);
};

// Harness-only entry point. Never included in an app bundle.
export {};
const entry = process.env.ABSOLUTE_TEST_RELEASE_SERVER;
const cert = process.env.ABSOLUTE_TEST_RELEASE_CERT;
const key = process.env.ABSOLUTE_TEST_RELEASE_KEY;
if (!entry || !cert || !key)
	throw new Error('Missing local release proof configuration');
const { app } = await import(entry);
app.listen({
	hostname: '127.0.0.1',
	port: 48443,
	tls: { cert: await Bun.file(cert).text(), key: await Bun.file(key).text() }
});

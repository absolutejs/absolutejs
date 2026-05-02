const { createHash } = require('node:crypto');

exports.readCjsProbe = () =>
	`CJS_${createHash('sha1').update('compile').digest('hex').slice(0, 8)}`;

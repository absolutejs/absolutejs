/** The value, or a failure that says what was missing. For a test that
 *  needs something a `find` or an index may not return: an assertion
 *  with a name, where `!` would be a crash without one. */
export const required = <T>(value: T | null | undefined, what: string) => {
	if (value === null || value === undefined)
		throw new Error(`Expected ${what}, found none.`);

	return value;
};

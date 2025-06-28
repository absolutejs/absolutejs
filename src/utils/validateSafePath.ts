import { resolve, relative, sep } from "node:path";

export const validateSafePath = (targetPath: string, baseDirectory: string) => {
	const absoluteBase = resolve(baseDirectory);
	const absoluteTarget = resolve(baseDirectory, targetPath);
	if (relative(absoluteBase, absoluteTarget).startsWith(`..${sep}`)) {
		throw new Error(`Unsafe path: ${targetPath}`);
	}

	return absoluteTarget;
};

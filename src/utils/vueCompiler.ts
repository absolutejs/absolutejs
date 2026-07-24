type VueCompiler = typeof import('@vue/compiler-sfc');

const createVueCompiler = async () => {
	const [compiler, typescript] = await Promise.all([
		import('@vue/compiler-sfc'),
		import('typescript')
	]);
	compiler.registerTS?.(() => typescript);

	return compiler;
};

let compilerPromise: Promise<VueCompiler> | undefined;

export const loadVueCompiler = () => {
	compilerPromise ??= createVueCompiler();

	return compilerPromise;
};

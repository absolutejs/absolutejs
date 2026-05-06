export default function renderError(error: {
	name: string;
	message: string;
	stack?: string;
}) {
	return `<!DOCTYPE html><html><head><title>Dependency error</title></head><body><h1>DEPENDENCY_ERROR_CONVENTION</h1><p>${error.message}</p></body></html>`;
}

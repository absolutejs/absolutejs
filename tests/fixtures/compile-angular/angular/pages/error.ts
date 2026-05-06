export default function renderError(error: {
	name: string;
	message: string;
	stack?: string;
}) {
	return `<!DOCTYPE html><html><head><title>Angular error</title></head><body><h1>ANGULAR_ERROR_CONVENTION</h1><p>${error.message}</p></body></html>`;
}

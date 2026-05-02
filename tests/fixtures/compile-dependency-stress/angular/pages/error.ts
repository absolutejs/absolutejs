export default function renderError(props: { error?: { message?: string } }) {
	return `<!DOCTYPE html><html><head><title>Dependency error</title></head><body><h1>DEPENDENCY_ERROR_CONVENTION</h1><p>${props.error?.message ?? ''}</p></body></html>`;
}

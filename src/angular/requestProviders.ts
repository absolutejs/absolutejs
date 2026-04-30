import type { AngularDeps } from '../../types/angular';

export { REQUEST, REQUEST_CONTEXT, RESPONSE_INIT } from '@angular/core';

export const buildRequestProviders = (
	deps: AngularDeps,
	request: Request | undefined,
	requestContext: unknown,
	responseInit: ResponseInit | undefined
) => [
	{ provide: deps.REQUEST, useValue: request ?? null },
	{ provide: deps.REQUEST_CONTEXT, useValue: requestContext ?? null },
	{ provide: deps.RESPONSE_INIT, useValue: responseInit ?? null }
];

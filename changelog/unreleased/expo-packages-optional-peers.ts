import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Every AbsoluteJS application used to install Expo and React Native, because the framework depended on `@absolutejs/devices-expo` (which needs both as peers) and on `@expo/code-signing-certificates`. A web application never runs either, but it carried them, and with them packages a vulnerability scan flags with no fixed release (node-forge through the signing certificates, braces through Metro). Both are now optional peer dependencies. `absolute mobile` installs `@absolutejs/devices` and `@absolutejs/devices-expo` into an Expo application the first time it needs them, the way it already installs Capacitor, and `absolute mobile update signing generate` installs `@expo/code-signing-certificates` as a development dependency. The framework no longer bundles node-forge into its CLI. Calling `generateAbsoluteExpoCodeSigning` directly now needs `@expo/code-signing-certificates` installed in the application, and says so if it is not.',
	kind: 'changed',
	summary:
		'Web applications no longer install Expo, React Native or the Expo code-signing tooling; `absolute mobile` installs them for Expo apps',
	symbols: ['generateAbsoluteExpoCodeSigning']
};

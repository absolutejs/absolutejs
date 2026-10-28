import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: 'Capacitor 8 ships no shared Xcode scheme and its .gitignore excludes xcuserdata, so a fresh checkout such as a GitHub Actions runner has no .xcscheme file. `mobile build ios` and the simulator certification failed there with "iOS release could not find a shared Xcode scheme"; they only worked on a Mac where opening the project in Xcode had created a user scheme. With no shared scheme, the release now asks Xcode for its schemes (`xcodebuild -list -json`) and uses the only one, or the one named after the project (`App` for Capacitor), beside the scheme for each local Swift package. A shared scheme is still used as before, and an explicit scheme still wins. By Gene Graves.',
	kind: 'fixed',
	summary: 'Signed iOS builds find their Xcode scheme on a fresh checkout',
	symbols: ['resolveAbsoluteIosXcodeProject']
};

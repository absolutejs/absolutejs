import { existsSync } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import type { NormalizedAbsoluteMobileConfig } from './config';

export const ABSOLUTE_MOBILE_CI_WORKFLOW_FORMAT = 1 as const;

export type AbsoluteMobileGithubWorkflowOptions = {
	config: NormalizedAbsoluteMobileConfig;
	configPath?: string;
	force?: boolean;
	includePublishing?: boolean;
	outputPath?: string;
	projectRoot: string;
	registryModule?: string;
	secretEnvironment?: readonly string[];
	serverEntry?: string;
};

export type AbsoluteMobileGithubWorkflowResult = {
	changed: boolean;
	format: typeof ABSOLUTE_MOBILE_CI_WORKFLOW_FORMAT;
	path: string;
	platforms: ('android' | 'ios')[];
	publishing: boolean;
	requiredSecrets: string[];
};

const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/u;
const CI_ENV_INDENTATION = 6;
const RESERVED_SECRET_NAMES = new Set([
	'ABSOLUTE_ANDROID_KEYSTORE_BASE64',
	'ABSOLUTE_ANDROID_KEYSTORE_PASSWORD',
	'ABSOLUTE_ANDROID_KEY_ALIAS',
	'ABSOLUTE_ANDROID_KEY_PASSWORD',
	'ABSOLUTE_GOOGLE_CREDENTIALS_BASE64',
	'ABSOLUTE_IOS_CERTIFICATE_BASE64',
	'ABSOLUTE_IOS_CERTIFICATE_PASSWORD',
	'ABSOLUTE_IOS_PROVISIONING_PROFILE_BASE64',
	'ABSOLUTE_IOS_KEYCHAIN_PASSWORD',
	'ABSOLUTE_IOS_DEVELOPMENT_TEAM',
	'APP_STORE_CONNECT_ISSUER_ID',
	'APP_STORE_CONNECT_KEY_ID',
	'APP_STORE_CONNECT_PRIVATE_KEY_BASE64'
]);

const exists = async (path: string) => {
	try {
		await access(path);

		return true;
	} catch {
		return false;
	}
};

const yamlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

const projectPath = (
	projectRoot: string,
	value: string,
	field: string,
	options: { allowMissing?: boolean } = {}
) => {
	const root = resolve(projectRoot);
	const path = resolve(root, value);
	const portable = relative(root, path).replaceAll('\\', '/');
	if (
		portable === '..' ||
		portable.startsWith(`..${sep}`) ||
		portable.startsWith('../') ||
		portable === ''
	) {
		throw new TypeError(`${field} must remain inside the project root.`);
	}
	if (/\r|\n/u.test(portable) || portable.startsWith('-'))
		throw new TypeError(`${field} contains an unsafe path.`);
	if (!options.allowMissing && !existsSync(path))
		throw new TypeError(`${field} does not exist inside the project.`);

	return portable;
};

const workflowOutputPath = (projectRoot: string, value?: string) => {
	const root = resolve(projectRoot);
	const workflows = resolve(root, '.github/workflows');
	const path = resolve(
		root,
		value ?? '.github/workflows/absolute-mobile.yml'
	);
	const portable = relative(workflows, path);
	if (
		portable === '..' ||
		portable.startsWith(`..${sep}`) ||
		(extname(path) !== '.yml' && extname(path) !== '.yaml')
	) {
		throw new TypeError(
			'mobile ci github --output must be a .yml or .yaml file inside .github/workflows.'
		);
	}

	return path;
};

const normalizeSecretEnvironment = (values: readonly string[] = []) => {
	const names = [...new Set(values)].sort();
	for (const name of names) {
		if (!SECRET_NAME_PATTERN.test(name))
			throw new TypeError(
				'mobile ci github --secret-env values must be uppercase environment variable names.'
			);
		if (
			name.startsWith('GITHUB_') ||
			name.startsWith('RUNNER_') ||
			name.startsWith('ACTIONS_') ||
			RESERVED_SECRET_NAMES.has(name)
		) {
			throw new TypeError(
				`mobile ci github --secret-env cannot replace reserved variable ${name}.`
			);
		}
	}

	return names;
};

const customSecretEnvironment = (
	names: readonly string[],
	indentation = CI_ENV_INDENTATION
) =>
	names
		.map(
			(name) =>
				`${' '.repeat(indentation)}${name}: \${{ secrets.${name} }}`
		)
		.join('\n');

type CommandEnvironmentOptions = {
	configPath?: string;
	registryModule: string;
	serverEntry: string;
};

type PlatformJobOptions = {
	customSecrets: readonly string[];
	includePublishing: boolean;
};

const commandEnvironment = (options: CommandEnvironmentOptions) =>
	`      ABSOLUTE_CONFIG_PATH: ${yamlString(options.configPath ?? '')}
      ABSOLUTE_REGISTRY_MODULE: ${yamlString(options.registryModule)}
      ABSOLUTE_SERVER_ENTRY: ${yamlString(options.serverEntry)}`;

const appendConfigArgument = `if [[ -n "$ABSOLUTE_CONFIG_PATH" ]]; then
            args+=(--config "$ABSOLUTE_CONFIG_PATH")
          fi`;

const installSteps = `      - name: Check out source
        uses: actions/checkout@v6
      - name: Install Bun
        uses: oven-sh/setup-bun@v2
      - name: Install exact dependencies
        run: bun ci`;

const bundleAuditSteps = `      - name: Prepare production mobile bundle
        shell: bash
        run: |
          args=(bunx absolute prepare "$ABSOLUTE_SERVER_ENTRY" --outdir .absolutejs/mobile-ci/server)
          ${appendConfigArgument}
          "\${args[@]}"
      - name: Run cryptographic mobile bundle audit
        id: mobile-bundle-audit
        continue-on-error: true
        shell: bash
        run: |
          mkdir -p .absolutejs/mobile-ci
          args=(bunx absolute mobile inspect --json --require-bundle)
          ${appendConfigArgument}
          "\${args[@]}" > .absolutejs/mobile-ci/inspection.json
      - name: Upload mobile inspection report
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: absolute-mobile-inspection
          path: .absolutejs/mobile-ci/inspection.json
          if-no-files-found: error
          retention-days: 30
          include-hidden-files: true
      - name: Enforce mobile bundle audit
        if: steps.mobile-bundle-audit.outcome != 'success'
        run: exit 1`;

const releaseAuditSteps = (
	platform: 'android' | 'ios'
) => `      - name: Run redacted mobile release audit
        id: mobile-release-audit
        continue-on-error: true
        shell: bash
        run: |
          mkdir -p .absolutejs/mobile-ci
          args=(bunx absolute mobile doctor release ${platform} --json)
          ${appendConfigArgument}
          "\${args[@]}" > .absolutejs/mobile-ci/compliance.json
      - name: Upload mobile compliance report
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: absolute-mobile-compliance-\${{ github.job }}
          path: .absolutejs/mobile-ci/compliance.json
          if-no-files-found: error
          retention-days: 30
          include-hidden-files: true
      - name: Enforce mobile release audit
        if: steps.mobile-release-audit.outcome != 'success'
        run: exit 1`;

const platformInput = (platforms: readonly string[]) => {
	const choices = platforms.length === 2 ? ['all', ...platforms] : platforms;

	return `      platform:
        description: Native platform to build
        required: true
        type: choice
        default: ${choices[0]}
        options:
${choices.map((value) => `          - ${value}`).join('\n')}`;
};

const publishingInputs = (
	platforms: readonly string[],
	includePublishing: boolean
) => {
	if (!includePublishing) return '';
	const fields = [
		`      publish:
        description: Publish through mobile.release.ts after the signed build
        required: true
        type: boolean
        default: false`,
		`      channel:
        description: Optional AbsoluteJS immutable release channel
        required: false
        type: string`
	];
	if (platforms.includes('android'))
		fields.push(`      play_track:
        description: Optional Google Play track
        required: true
        type: choice
        default: registry-only
        options:
          - registry-only
          - internal
          - alpha
          - beta
          - production`);
	if (platforms.includes('ios')) {
		fields.push(`      testflight_group:
        description: Optional internal or external TestFlight group
        required: false
        type: string`);
		fields.push(`      submit_testflight_review:
        description: Explicitly submit an external TestFlight build for review
        required: true
        type: boolean
        default: false`);
	}

	return `\n${fields.join('\n')}`;
};

const jobCondition = (platform: 'android' | 'ios') =>
	`github.event_name == 'workflow_dispatch' && (inputs.platform == 'all' || inputs.platform == '${platform}')`;

const androidJob = (options: PlatformJobOptions) => {
	const custom = customSecretEnvironment(options.customSecrets);
	const publishEnvironment = options.includePublishing
		? `
      ABSOLUTE_PUBLISH: \${{ inputs.publish }}
      ABSOLUTE_RELEASE_CHANNEL: \${{ inputs.channel }}
      ABSOLUTE_PLAY_TRACK: \${{ inputs.play_track }}
      ABSOLUTE_GOOGLE_CREDENTIALS_BASE64: \${{ secrets.ABSOLUTE_GOOGLE_CREDENTIALS_BASE64 }}
      GOOGLE_APPLICATION_CREDENTIALS: \${{ runner.temp }}/absolute-google-credentials.json`
		: '';
	const publishCommand = options.includePublishing
		? `if [[ "$ABSOLUTE_PUBLISH" == "true" ]]; then
            args=(bunx absolute mobile publish android "$ABSOLUTE_SERVER_ENTRY" --registry "$ABSOLUTE_REGISTRY_MODULE")
            if [[ -n "$ABSOLUTE_RELEASE_CHANNEL" ]]; then
              args+=(--channel "$ABSOLUTE_RELEASE_CHANNEL")
            fi
            if [[ "$ABSOLUTE_PLAY_TRACK" != "registry-only" ]]; then
              args+=(--play-track "$ABSOLUTE_PLAY_TRACK")
            fi
          else
            args=(bunx absolute mobile build android "$ABSOLUTE_SERVER_ENTRY")
          fi`
		: `args=(bunx absolute mobile build android "$ABSOLUTE_SERVER_ENTRY")`;
	const googleSetup = options.includePublishing
		? `
          if [[ "$ABSOLUTE_PUBLISH" == "true" && "$ABSOLUTE_PLAY_TRACK" != "registry-only" ]]; then
            if [[ -z "$ABSOLUTE_GOOGLE_CREDENTIALS_BASE64" ]]; then
              echo "ABSOLUTE_GOOGLE_CREDENTIALS_BASE64 is required for Google Play publication." >&2
              exit 1
            fi
            printf '%s' "$ABSOLUTE_GOOGLE_CREDENTIALS_BASE64" | base64 --decode > "$GOOGLE_APPLICATION_CREDENTIALS"
            chmod 600 "$GOOGLE_APPLICATION_CREDENTIALS"
          fi`
		: '';

	return `
  android:
    name: Signed Android release
    needs: validate
    if: \${{ ${jobCondition('android')} }}
    runs-on: ubuntu-latest
    environment: absolute-mobile-release
    permissions:
      contents: read
      id-token: write
      attestations: write
    env:
      ABSOLUTE_ANDROID_KEYSTORE_BASE64: \${{ secrets.ABSOLUTE_ANDROID_KEYSTORE_BASE64 }}
      ABSOLUTE_ANDROID_KEYSTORE_PASSWORD: \${{ secrets.ABSOLUTE_ANDROID_KEYSTORE_PASSWORD }}
      ABSOLUTE_ANDROID_KEY_ALIAS: \${{ secrets.ABSOLUTE_ANDROID_KEY_ALIAS }}
      ABSOLUTE_ANDROID_KEY_PASSWORD: \${{ secrets.ABSOLUTE_ANDROID_KEY_PASSWORD }}
      ABSOLUTE_ANDROID_KEYSTORE_PATH: \${{ runner.temp }}/absolute-release.jks${publishEnvironment}${custom ? `\n${custom}` : ''}
${commandEnvironment({ configPath: undefined, registryModule: '', serverEntry: '' })}
    steps:
${installSteps}
      - name: Provision Android signing
        shell: bash
        run: |
          required=(
            ABSOLUTE_ANDROID_KEYSTORE_BASE64
            ABSOLUTE_ANDROID_KEYSTORE_PASSWORD
            ABSOLUTE_ANDROID_KEY_ALIAS
            ABSOLUTE_ANDROID_KEY_PASSWORD
          )
          for name in "\${required[@]}"; do
            if [[ -z "\${!name}" ]]; then
              echo "$name is required in the absolute-mobile-release environment." >&2
              exit 1
            fi
          done
          printf '%s' "$ABSOLUTE_ANDROID_KEYSTORE_BASE64" | base64 --decode > "\${{ runner.temp }}/absolute-release.jks"
          chmod 600 "\${{ runner.temp }}/absolute-release.jks"${googleSetup}
      - name: Build or publish Android
        shell: bash
        run: |
          ${publishCommand}
          ${appendConfigArgument}
          "\${args[@]}"
${releaseAuditSteps('android')}
      - name: Attest Android App Bundle
        if: inputs.attest
        uses: actions/attest@v4
        with:
          subject-path: .absolutejs/mobile/releases/android/**/app-release.aab
      - name: Upload Android release
        uses: actions/upload-artifact@v7
        with:
          name: absolute-mobile-android
          path: .absolutejs/mobile/releases/android/
          if-no-files-found: error
          retention-days: 14
          include-hidden-files: true
      - name: Remove Android credentials
        if: always()
        shell: bash
        run: |
          rm -f "\${{ runner.temp }}/absolute-release.jks"
          rm -f "\${{ runner.temp }}/absolute-google-credentials.json"`;
};

const iosJob = (options: PlatformJobOptions) => {
	const custom = customSecretEnvironment(options.customSecrets);
	const publishEnvironment = options.includePublishing
		? `
      ABSOLUTE_PUBLISH: \${{ inputs.publish }}
      ABSOLUTE_RELEASE_CHANNEL: \${{ inputs.channel }}
      ABSOLUTE_TESTFLIGHT_GROUP: \${{ inputs.testflight_group }}
      ABSOLUTE_TESTFLIGHT_SUBMIT_REVIEW: \${{ inputs.submit_testflight_review }}
      APP_STORE_CONNECT_ISSUER_ID: \${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}
      APP_STORE_CONNECT_KEY_ID: \${{ secrets.APP_STORE_CONNECT_KEY_ID }}
      APP_STORE_CONNECT_PRIVATE_KEY_BASE64: \${{ secrets.APP_STORE_CONNECT_PRIVATE_KEY_BASE64 }}
      APP_STORE_CONNECT_PRIVATE_KEY_PATH: \${{ runner.temp }}/AuthKey_AbsoluteJS.p8`
		: '';
	const publishCommand = options.includePublishing
		? `if [[ "$ABSOLUTE_PUBLISH" == "true" ]]; then
            args=(bunx absolute mobile publish ios "$ABSOLUTE_SERVER_ENTRY" --registry "$ABSOLUTE_REGISTRY_MODULE")
            if [[ -n "$ABSOLUTE_RELEASE_CHANNEL" ]]; then
              args+=(--channel "$ABSOLUTE_RELEASE_CHANNEL")
            fi
            if [[ -n "$ABSOLUTE_TESTFLIGHT_GROUP" ]]; then
              args+=(--testflight-group "$ABSOLUTE_TESTFLIGHT_GROUP")
            fi
            if [[ "$ABSOLUTE_TESTFLIGHT_SUBMIT_REVIEW" == "true" ]]; then
              args+=(--testflight-submit-review)
            fi
          else
            args=(bunx absolute mobile build ios "$ABSOLUTE_SERVER_ENTRY")
          fi`
		: `args=(bunx absolute mobile build ios "$ABSOLUTE_SERVER_ENTRY")`;
	const appStoreSetup = options.includePublishing
		? `
          if [[ "$ABSOLUTE_PUBLISH" == "true" && -n "$ABSOLUTE_TESTFLIGHT_GROUP" ]]; then
            required+=(APP_STORE_CONNECT_ISSUER_ID APP_STORE_CONNECT_KEY_ID APP_STORE_CONNECT_PRIVATE_KEY_BASE64)
          fi`
		: '';
	const appStoreDecode = options.includePublishing
		? `
          if [[ "$ABSOLUTE_PUBLISH" == "true" && -n "$ABSOLUTE_TESTFLIGHT_GROUP" ]]; then
            printf '%s' "$APP_STORE_CONNECT_PRIVATE_KEY_BASE64" | base64 --decode > "$APP_STORE_CONNECT_PRIVATE_KEY_PATH"
            chmod 600 "$APP_STORE_CONNECT_PRIVATE_KEY_PATH"
          fi`
		: '';

	return `
  ios:
    name: Signed iOS release
    needs: validate
    if: \${{ ${jobCondition('ios')} }}
    runs-on: macos-latest
    environment: absolute-mobile-release
    permissions:
      contents: read
      id-token: write
      attestations: write
    env:
      ABSOLUTE_IOS_CERTIFICATE_BASE64: \${{ secrets.ABSOLUTE_IOS_CERTIFICATE_BASE64 }}
      ABSOLUTE_IOS_CERTIFICATE_PASSWORD: \${{ secrets.ABSOLUTE_IOS_CERTIFICATE_PASSWORD }}
      ABSOLUTE_IOS_PROVISIONING_PROFILE_BASE64: \${{ secrets.ABSOLUTE_IOS_PROVISIONING_PROFILE_BASE64 }}
      ABSOLUTE_IOS_KEYCHAIN_PASSWORD: \${{ secrets.ABSOLUTE_IOS_KEYCHAIN_PASSWORD }}${publishEnvironment}${custom ? `\n${custom}` : ''}
      ABSOLUTE_IOS_DEVELOPMENT_TEAM: \${{ secrets.ABSOLUTE_IOS_DEVELOPMENT_TEAM }}
${commandEnvironment({ configPath: undefined, registryModule: '', serverEntry: '' })}
    steps:
${installSteps}
      - name: Provision iOS signing
        shell: bash
        run: |
          required=(
            ABSOLUTE_IOS_CERTIFICATE_BASE64
            ABSOLUTE_IOS_CERTIFICATE_PASSWORD
            ABSOLUTE_IOS_PROVISIONING_PROFILE_BASE64
            ABSOLUTE_IOS_KEYCHAIN_PASSWORD
            ABSOLUTE_IOS_DEVELOPMENT_TEAM
          )${appStoreSetup}
          for name in "\${required[@]}"; do
            if [[ -z "\${!name}" ]]; then
              echo "$name is required in the absolute-mobile-release environment." >&2
              exit 1
            fi
          done
          CERTIFICATE_PATH="\${{ runner.temp }}/absolute-signing.p12"
          PROFILE_PATH="\${{ runner.temp }}/absolute.mobileprovision"
          KEYCHAIN_PATH="\${{ runner.temp }}/absolute-signing.keychain-db"
          PROFILE_DESTINATION="$HOME/Library/MobileDevice/Provisioning Profiles/absolute.mobileprovision"
          printf '%s' "$ABSOLUTE_IOS_CERTIFICATE_BASE64" | base64 --decode > "$CERTIFICATE_PATH"
          printf '%s' "$ABSOLUTE_IOS_PROVISIONING_PROFILE_BASE64" | base64 --decode > "$PROFILE_PATH"
          security create-keychain -p "$ABSOLUTE_IOS_KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
          security unlock-keychain -p "$ABSOLUTE_IOS_KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security import "$CERTIFICATE_PATH" -P "$ABSOLUTE_IOS_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
          security set-key-partition-list -S apple-tool:,apple: -k "$ABSOLUTE_IOS_KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
          security list-keychain -d user -s "$KEYCHAIN_PATH"
          mkdir -p "$(dirname "$PROFILE_DESTINATION")"
          cp "$PROFILE_PATH" "$PROFILE_DESTINATION"${appStoreDecode}
      - name: Build or publish iOS
        shell: bash
        run: |
          ${publishCommand}
          ${appendConfigArgument}
          "\${args[@]}"
${releaseAuditSteps('ios')}
      - name: Attest iOS IPA
        if: inputs.attest
        uses: actions/attest@v4
        with:
          subject-path: .absolutejs/mobile/releases/ios/**/App.ipa
      - name: Upload iOS release
        uses: actions/upload-artifact@v7
        with:
          name: absolute-mobile-ios
          path: .absolutejs/mobile/releases/ios/
          if-no-files-found: error
          retention-days: 14
          include-hidden-files: true
      - name: Remove iOS credentials
        if: always()
        shell: bash
        run: |
          security delete-keychain "\${{ runner.temp }}/absolute-signing.keychain-db" 2>/dev/null || true
          rm -f "$HOME/Library/MobileDevice/Provisioning Profiles/absolute.mobileprovision"
          rm -f "\${{ runner.temp }}/absolute-signing.p12"
          rm -f "\${{ runner.temp }}/absolute.mobileprovision"
          rm -f "\${{ runner.temp }}/AuthKey_AbsoluteJS.p8"`;
};

const requiredSecrets = (
	platforms: readonly string[],
	includePublishing: boolean,
	custom: readonly string[]
) => [
	...(platforms.includes('android')
		? [
				'ABSOLUTE_ANDROID_KEYSTORE_BASE64',
				'ABSOLUTE_ANDROID_KEYSTORE_PASSWORD',
				'ABSOLUTE_ANDROID_KEY_ALIAS',
				'ABSOLUTE_ANDROID_KEY_PASSWORD',
				...(includePublishing
					? ['ABSOLUTE_GOOGLE_CREDENTIALS_BASE64']
					: [])
			]
		: []),
	...(platforms.includes('ios')
		? [
				'ABSOLUTE_IOS_CERTIFICATE_BASE64',
				'ABSOLUTE_IOS_CERTIFICATE_PASSWORD',
				'ABSOLUTE_IOS_PROVISIONING_PROFILE_BASE64',
				'ABSOLUTE_IOS_KEYCHAIN_PASSWORD',
				'ABSOLUTE_IOS_DEVELOPMENT_TEAM',
				...(includePublishing
					? [
							'APP_STORE_CONNECT_ISSUER_ID',
							'APP_STORE_CONNECT_KEY_ID',
							'APP_STORE_CONNECT_PRIVATE_KEY_BASE64'
						]
					: [])
			]
		: []),
	...custom
];

export const createAbsoluteMobileGithubWorkflow = (
	options: AbsoluteMobileGithubWorkflowOptions
) => {
	const platforms: ('android' | 'ios')[] = [
		...(options.config.engine === 'expo'
			? options.config.platforms.filter(
					(platform): platform is 'android' => platform === 'android'
				)
			: options.config.platforms)
	].sort();
	if (platforms.length === 0)
		throw new TypeError(
			'Generated Expo production CI currently requires android in mobile.platforms; Expo iOS release automation is the next checkpoint.'
		);
	const includePublishing = options.includePublishing === true;
	const customSecrets = normalizeSecretEnvironment(options.secretEnvironment);
	const serverEntry = projectPath(
		options.projectRoot,
		options.serverEntry ?? 'server.ts',
		'mobile ci github server entry'
	);
	const configPath = options.configPath
		? projectPath(
				options.projectRoot,
				options.configPath,
				'mobile ci github --config'
			)
		: undefined;
	const registryModule = projectPath(
		options.projectRoot,
		options.registryModule ?? 'mobile.release.ts',
		'mobile ci github --registry',
		{ allowMissing: !includePublishing }
	);
	const environment = commandEnvironment({
		configPath,
		registryModule,
		serverEntry
	});
	let workflow = `# Generated by AbsoluteJS. Regenerate with: absolute mobile ci github${includePublishing ? ' --publish' : ''}
name: AbsoluteJS Mobile

on:
  pull_request:
  workflow_dispatch:
    inputs:
${platformInput(platforms)}
      attest:
        description: Generate GitHub artifact provenance attestations
        required: true
        type: boolean
        default: false${publishingInputs(platforms, includePublishing)}

concurrency:
  group: absolute-mobile-\${{ github.repository }}
  cancel-in-progress: false

jobs:
  validate:
    name: Validate mobile release inputs
    runs-on: ubuntu-latest
    permissions:
      contents: read
    env:
${environment}
    steps:
${installSteps}
${bundleAuditSteps}${platforms.includes('android') ? androidJob({ customSecrets, includePublishing }) : ''}${platforms.includes('ios') ? iosJob({ customSecrets, includePublishing }) : ''}
`;
	const replacements = new Map([
		[
			"ABSOLUTE_CONFIG_PATH: ''",
			`ABSOLUTE_CONFIG_PATH: ${yamlString(configPath ?? '')}`
		],
		[
			"ABSOLUTE_REGISTRY_MODULE: ''",
			`ABSOLUTE_REGISTRY_MODULE: ${yamlString(registryModule)}`
		],
		[
			"ABSOLUTE_SERVER_ENTRY: ''",
			`ABSOLUTE_SERVER_ENTRY: ${yamlString(serverEntry)}`
		]
	]);
	for (const [placeholder, replacement] of replacements)
		workflow = workflow.replaceAll(placeholder, replacement);

	return {
		requiredSecrets: requiredSecrets(
			platforms,
			includePublishing,
			customSecrets
		),
		workflow
	};
};

export const writeAbsoluteMobileGithubWorkflow = async (
	options: AbsoluteMobileGithubWorkflowOptions
): Promise<AbsoluteMobileGithubWorkflowResult> => {
	const path = workflowOutputPath(options.projectRoot, options.outputPath);
	const generated = createAbsoluteMobileGithubWorkflow(options);
	const previous = (await exists(path))
		? await readFile(path, 'utf8')
		: undefined;
	if (
		previous !== undefined &&
		previous !== generated.workflow &&
		!options.force
	)
		throw new TypeError(
			`${relative(options.projectRoot, path)} already exists and differs. Rerun with --force to replace the generated workflow.`
		);
	if (previous !== generated.workflow) {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, generated.workflow);
	}

	return {
		changed: previous !== generated.workflow,
		format: ABSOLUTE_MOBILE_CI_WORKFLOW_FORMAT,
		path,
		platforms:
			options.config.engine === 'expo'
				? options.config.platforms.filter(
						(platform): platform is 'android' =>
							platform === 'android'
					)
				: [...options.config.platforms].sort(),
		publishing: options.includePublishing === true,
		requiredSecrets: generated.requiredSecrets
	};
};

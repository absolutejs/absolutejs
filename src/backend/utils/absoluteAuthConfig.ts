import {
	createAuthConfiguration,
	isValidProviderOption,
	instantiateUserSession
} from '@absolutejs/auth';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { SchemaType, User, schema } from '../../../db/schema';
import { providerData } from '../../frontend/data/providerData';
import { createUser, getUser } from '../handlers/userHandlers';
import { providersConfiguration } from './providersConfiguration';

export const absoluteAuthConfig = (db: NeonHttpDatabase<SchemaType>) =>
	createAuthConfiguration<User>({
		providersConfiguration: providersConfiguration,
		onAuthorize: ({ authProvider, authorizationUrl }) => {
			const providerName = isValidProviderOption(authProvider)
				? providerData[authProvider].name
				: authProvider;

			console.log(
				`\nRedirecting to ${providerName} authorization URL:`,
				authorizationUrl.toString()
			);
		},
		onCallback: async ({
			authProvider,
			userProfile,
			tokenResponse,
			user_session_id,
			session
		}) => {
			const providerName = isValidProviderOption(authProvider)
				? providerData[authProvider].name
				: authProvider;

			console.log(
				`\nSuccesfully authorized OAuth2 with ${providerName} and got token response:`,
				{
					...tokenResponse
				}
			);

			return instantiateUserSession<User>({
				authProvider,
				session,
				tokenResponse,
				user_session_id,
				userProfile,
				createUser: async () => {
					const user = await createUser({
						authProvider,
						db,
						schema,
						userProfile
					});
					if (user === undefined)
						throw new Error('Failed to create user');

					return user;
				},
				getUser: async () => {
					const user = await getUser({
						authProvider,
						db,
						schema,
						userProfile
					});

					return user;
				}
			});
		},
		onProfile: ({ authProvider, userProfile }) => {
			const providerName = isValidProviderOption(authProvider)
				? providerData[authProvider].name
				: authProvider;

			console.log(`\nSuccessfully fetched ${providerName} profile:`, {
				...userProfile
			});
		},
		onRefresh: ({ authProvider, tokenResponse }) => {
			const providerName = isValidProviderOption(authProvider)
				? providerData[authProvider].name
				: authProvider;

			console.log(
				`\nSuccessfully refreshed ${providerName} OAuth2 and recieved token response:`,
				{
					...tokenResponse
				}
			);
		},
		onRevocation: ({ authProvider, tokenToRevoke }) => {
			const providerName = isValidProviderOption(authProvider)
				? providerData[authProvider].name
				: authProvider;

			console.log(
				`\nSuccessfully revoked ${providerName} token:`,
				tokenToRevoke
			);
		},
		onSignOut: ({ authProvider, user }) => {
			const providerName = isValidProviderOption(authProvider)
				? providerData[authProvider].name
				: authProvider;

			console.log(
				`\nSuccessfully signed out ${providerName} user:`,
				user
			);
		},
		onStatus: ({ user }) => {
			if (user === null) {
				console.log('\nSuccessfully checked user is not logged in');
			} else {
				console.log(`\nSuccessfully checked user status:`, user);
			}
		}
	});

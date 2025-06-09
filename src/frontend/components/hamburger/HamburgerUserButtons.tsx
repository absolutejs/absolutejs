import { animated } from '@react-spring/web';
import { User } from '../../../../db/schema';
import { primaryColor } from '../../styles/colors';
import { buttonStyle } from '../../styles/styles';
import { ProfilePicture } from '../utils/ProfilePicture';

type HamburgerUserButtonsProps = {
	user: User | undefined;
	handleSignOut: () => Promise<void>;
	openModal: () => void;
};

export const HamburgerUserButtons = ({
	user,
	handleSignOut,
	openModal
}: HamburgerUserButtonsProps) => (
	<div
		style={{
			alignItems: 'center',
			display: 'flex',
			justifyContent: 'space-between',
			width: '100%'
		}}
	>
		{user !== undefined && (
			<div
				style={{
					alignItems: 'center',
					display: 'flex',
					flexDirection: 'row'
				}}
			>
				<animated.a href="/portal">
					<ProfilePicture
						userImage={
							typeof user.metadata?.profile_picture === 'string'
								? user.metadata.profile_picture
								: undefined
						}
						backupImage={'/assets/svg/default-profile-icon.svg'}
						width="100%"
						height="100%"
					/>
				</animated.a>
				<span style={{ color: primaryColor, fontSize: '1.3rem' }}>
					{typeof user.metadata?.given_name === 'string'
						? user.metadata.given_name
						: ''}{' '}
					{typeof user.metadata?.family_name === 'string'
						? user.metadata.family_name
						: ''}
				</span>
			</div>
		)}
		<animated.button
			onClick={user ? () => handleSignOut() : openModal}
			style={buttonStyle({
				backgroundColor: primaryColor,
				color: 'white',
				width: '100%'
			})}
		>
			{user ? 'SignOut' : 'Login'}
		</animated.button>
	</div>
);

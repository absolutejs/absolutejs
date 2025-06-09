import { animated, SpringRef, SpringValue } from '@react-spring/web';
import { useState } from 'react';
import { User } from '../../../../db/schema';
import { isNavbarDropdown, ThemeColors } from '../../../types/types';
import { navbarData } from '../../data/navbarData';
import { AuthContainer } from '../auth/AuthContainer';
import { NavbarLink } from '../navbar/NavbarLink';
import { Modal } from '../utils/Modal';
import { HamburgerDropdown } from './HamburgerDropdown';
import { HamburgerHeader } from './HamburgerHeader';
import { HamburgerUserButtons } from './HamburgerUserButtons';

type HamburgerMenuProps = {
	spring: { transform: SpringValue<string> };
	springApi: SpringRef<{ transform: string }>;
	user: User | undefined;
	handleSignOut: () => Promise<void>;
	themeSprings: ThemeColors;
};

export const HamburgerMenu = ({
	spring,
	springApi,
	user,
	themeSprings,
	handleSignOut
}: HamburgerMenuProps) => {
	const [isModalOpen, setIsModalOpen] = useState(false);

	return (
		<animated.div
			style={{
				background: '#fff',
				display: 'flex',
				flexDirection: 'column',
				height: '100%',
				justifyContent: 'flex-start',
				padding: '20px',
				position: 'fixed',
				right: 0,
				top: 0,
				transform: spring.transform,
				width: '100%',
				zIndex: 10000
			}}
		>
			<HamburgerHeader
				onClose={() =>
					void springApi.start({ transform: 'translateX(100%)' })
				}
			/>

			<nav
				style={{
					display: 'flex',
					flexDirection: 'column',
					marginTop: '100px',
					width: '100%'
				}}
			>
				{navbarData.map((element) => {
					if (isNavbarDropdown(element)) {
						return (
							<HamburgerDropdown
								themeSprings={themeSprings}
								key={element.label}
								label={element.label}
								href={element.href}
								links={element.links}
							/>
						);
					}

					return (
						<NavbarLink
							themeSprings={themeSprings}
							key={element.label}
							icon={element.icon}
							href={element.href}
							label={element.label}
						/>
					);
				})}
				<hr
					style={{
						border: '1px solid #ddd',
						margin: '20px 0',
						width: '100%'
					}}
				/>

				<HamburgerUserButtons
					user={user}
					handleSignOut={handleSignOut}
					openModal={() => {
						setIsModalOpen(true);
					}}
				/>
			</nav>
			<Modal
				isOpen={isModalOpen}
				onClose={() => {
					setIsModalOpen(false);
				}}
			>
				<AuthContainer themeSprings={themeSprings} />
			</Modal>
		</animated.div>
	);
};

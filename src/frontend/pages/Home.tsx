import { animated } from '@react-spring/web';
import { AuthArticle } from '../components/home/AuthArticle';
import { CodeQualityArticle } from '../components/home/CodeQualityArticle';
import { CommandSection } from '../components/home/CommandSection';
import { DatabaseArticle } from '../components/home/DatabaseArticle';
import { PerformanceArticle } from '../components/home/PerformanceArticle';
import { TypeSafeArticle } from '../components/home/TypeSafeArticle';
import { UIArticle } from '../components/home/UIArticle';
import { Navbar } from '../components/navbar/Navbar';
import { Head } from '../components/page/Head';
import { useAuthStatus } from '../hooks/useAuthStatus';
import { useThemeColors } from '../hooks/useThemeColors';
import { htmlDefault, bodyDefault, mainDefault } from '../styles/styles';

export const Home = () => {
	const { user, handleSignOut } = useAuthStatus();
	const themeSprings = useThemeColors();

	return (
		<html lang="en" style={htmlDefault}>
			<Head />
			<animated.body style={bodyDefault(themeSprings)}>
				<Navbar
					themeSprings={themeSprings}
					user={user}
					handleSignOut={handleSignOut}
				/>
				<main style={mainDefault}>
					<CommandSection themeSprings={themeSprings} />
					<TypeSafeArticle themeSprings={themeSprings} />
					<PerformanceArticle themeSprings={themeSprings} />
					<UIArticle themeSprings={themeSprings} />
					<DatabaseArticle themeSprings={themeSprings} />
					<CodeQualityArticle themeSprings={themeSprings} />
					<AuthArticle themeSprings={themeSprings} />
				</main>
			</animated.body>
		</html>
	);
};

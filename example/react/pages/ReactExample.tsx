import { App } from '../components/App';
import { Dropdown } from '../components/Dropdown';
import { Head } from '../components/Head';

type ReactExampleProps = {
	initialCount: number;
	cssPath?: string;
	cssPaths?: string[];
};

export const ReactExample = ({
	initialCount,
	cssPath,
	cssPaths
}: ReactExampleProps) => (
	<html>
		<Head cssPath={cssPath} cssPaths={cssPaths} />
		<body>
			<header>
				<a href="/">AbsoluteJS</a>
				<Dropdown />
			</header>
			<App initialCount={initialCount} />
		</body>
	</html>
);

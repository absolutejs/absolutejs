import { Link } from '../../../src/react/router/Link';
import { App } from '../components/App';
import { Dropdown } from '../components/Dropdown';
import { Head } from '../components/Head';

type ReactExampleProps = {
	initialCount: number;
	cssPath?: string;
};

export const ReactExample = ({ initialCount, cssPath }: ReactExampleProps) => (
	<html>
		<Head cssPath={cssPath} />
		<body>
			<header>
				<a href="/">AbsoluteJS</a>
				{/* Hovering this warms /vue's document, route data, module
				    and CSS before the click. See docs/DEV_PERFORMANCE.md. */}
				<Link href="/vue" id="vue-link" prefetch="hover">
					Vue
				</Link>
				<Dropdown />
			</header>
			<App initialCount={initialCount} />
		</body>
	</html>
);

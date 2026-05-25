import { PanelHost } from './PanelHost';
import { ESLINT_CSS } from '../eslint/eslintStyles';
import { TSCONFIG_CSS } from '../tsconfig/tsconfigStyles';
import { CONFIG_CSS } from './configStyles';
import { CONFIG_PANELS } from '../panels';
import type { ConfigPanelId, ConfigPanelMeta } from '../../../../types/config';

type ConfigShellProps = {
	panel: ConfigPanelId;
};

type NavItemProps = {
	active: boolean;
	panel: ConfigPanelMeta;
};

const NavItem = ({ active, panel }: NavItemProps) => (
	<a
		className="cfg-item"
		data-active={active}
		data-soon={panel.status === 'soon'}
		href={`/${panel.id}`}
	>
		<span className="cfg-item-top">
			<span className="cfg-item-name">{panel.label}</span>
			{panel.status === 'soon' && <span className="cfg-soon">soon</span>}
		</span>
		<span className="cfg-item-blurb">{panel.blurb}</span>
	</a>
);

type PanelGroup = {
	items: ConfigPanelMeta[];
	label: string;
};

const addToGroup = (
	entry: ConfigPanelMeta,
	order: string[],
	byGroup: Map<string, ConfigPanelMeta[]>
) => {
	const list = byGroup.get(entry.group);
	if (list) {
		list.push(entry);

		return;
	}
	order.push(entry.group);
	byGroup.set(entry.group, [entry]);
};

// Group the panels by their `group` field, preserving first-appearance order.
const groupedPanels = () => {
	const order: string[] = [];
	const byGroup = new Map<string, ConfigPanelMeta[]>();
	for (const entry of CONFIG_PANELS) addToGroup(entry, order, byGroup);

	return order.map((label) => ({ items: byGroup.get(label) ?? [], label }));
};

type NavGroupProps = {
	active: ConfigPanelId;
	group: PanelGroup;
};

const NavGroup = ({ active, group }: NavGroupProps) => (
	<div className="cfg-group">
		<div className="cfg-rail-label">{group.label}</div>
		{group.items.map((entry) => (
			<NavItem active={entry.id === active} key={entry.id} panel={entry} />
		))}
	</div>
);

export const ConfigShell = ({ panel }: ConfigShellProps) => {
	const active = CONFIG_PANELS.find((entry) => entry.id === panel);
	const activeLabel = active?.label ?? 'Config';

	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta
					content="width=device-width, initial-scale=1"
					name="viewport"
				/>
				<title>{`Absolute Config · ${activeLabel}`}</title>
				<link href="https://fonts.googleapis.com" rel="preconnect" />
				<link
					crossOrigin="anonymous"
					href="https://fonts.gstatic.com"
					rel="preconnect"
				/>
				<link
					href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap"
					rel="stylesheet"
				/>
				<style
					dangerouslySetInnerHTML={{
						__html: ESLINT_CSS + TSCONFIG_CSS + CONFIG_CSS
					}}
				/>
			</head>
			<body>
				<div className="cfg">
					<aside className="cfg-nav">
						<div className="cfg-brand">
							<span className="cfg-word">
								absolute <em>config</em>
							</span>
							<span className="cfg-tag">project tooling</span>
						</div>
						<nav className="cfg-panels">
							{groupedPanels().map((group) => (
								<NavGroup
									active={panel}
									group={group}
									key={group.label}
								/>
							))}
						</nav>
					</aside>
					<main className="cfg-main">
						<PanelHost panel={panel} />
					</main>
				</div>
			</body>
		</html>
	);
};

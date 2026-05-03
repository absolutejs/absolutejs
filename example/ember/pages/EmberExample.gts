import Component from '@glimmer/component';
import Counter from '../components/Counter';

interface EmberExampleArgs {
	initialCount: number;
	cssPath?: string;
}

export default class EmberExample extends Component<{ Args: EmberExampleArgs }> {
	<template>
		<header>
			<a href="/">AbsoluteJS</a>
			<nav>
				<a href="/html">HTML</a>
				<a href="/react">React</a>
				<a href="/htmx">HTMX</a>
				<a href="/svelte">Svelte</a>
				<a href="/vue">Vue</a>
				<a href="/angular">Angular</a>
				<a href="/ember">Ember</a>
			</nav>
		</header>

		<main>
			<nav>
				<a href="https://absolutejs.com" target="_blank">
					<img
						class="logo"
						src="/assets/png/absolutejs-temp.png"
						alt="AbsoluteJS Logo"
					/>
				</a>
				<a href="https://emberjs.com" target="_blank">
					<span class="logo ember">🐹 Ember</span>
				</a>
			</nav>

			<h1>AbsoluteJS + Ember</h1>

			<p class="subtitle">
				Glimmer component rendering through ember-source 6.12 + Bun + Elysia.
				Edit
				<code>example/ember/pages/EmberExample.gts</code>
				and save — the page reloads with the change.
			</p>

			<Counter @initialCount={{@initialCount}} />
		</main>

		<footer>
			<p>
				Built with
				<a href="https://emberjs.com" target="_blank">Ember</a>
				and rendered by
				<a href="https://absolutejs.com" target="_blank">AbsoluteJS</a>.
			</p>
		</footer>
	</template>
}

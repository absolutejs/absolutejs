import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

interface CounterArgs {
	initialCount: number;
}

export default class Counter extends Component<{ Args: CounterArgs }> {
	@tracked count = this.args.initialCount;

	increment = () => {
		this.count += 1;
	};

	<template>
		<button type="button" {{on "click" this.increment}}>
			count is {{this.count}}
		</button>
	</template>
}

<script setup lang="ts">
import { ref } from 'vue';
import CountButton from '../components/CountButton.vue';
import ScaleComp0 from '../components/_scale/ScaleComp0.vue';
import ScaleComp1 from '../components/_scale/ScaleComp1.vue';
import ScaleComp2 from '../components/_scale/ScaleComp2.vue';
import ScaleComp3 from '../components/_scale/ScaleComp3.vue';
import ScaleComp4 from '../components/_scale/ScaleComp4.vue';
import ScaleComp5 from '../components/_scale/ScaleComp5.vue';
import ScaleComp6 from '../components/_scale/ScaleComp6.vue';
import ScaleComp7 from '../components/_scale/ScaleComp7.vue';
import ScaleComp8 from '../components/_scale/ScaleComp8.vue';
import ScaleComp9 from '../components/_scale/ScaleComp9.vue';
import ScaleComp10 from '../components/_scale/ScaleComp10.vue';
import ScaleComp11 from '../components/_scale/ScaleComp11.vue';
import ScaleComp12 from '../components/_scale/ScaleComp12.vue';
import ScaleComp13 from '../components/_scale/ScaleComp13.vue';
import ScaleComp14 from '../components/_scale/ScaleComp14.vue';
import ScaleComp15 from '../components/_scale/ScaleComp15.vue';
import ScaleComp16 from '../components/_scale/ScaleComp16.vue';
import ScaleComp17 from '../components/_scale/ScaleComp17.vue';
import ScaleComp18 from '../components/_scale/ScaleComp18.vue';
import ScaleComp19 from '../components/_scale/ScaleComp19.vue';
import ScaleComp20 from '../components/_scale/ScaleComp20.vue';
import ScaleComp21 from '../components/_scale/ScaleComp21.vue';
import ScaleComp22 from '../components/_scale/ScaleComp22.vue';
import ScaleComp23 from '../components/_scale/ScaleComp23.vue';
import ScaleComp24 from '../components/_scale/ScaleComp24.vue';
import ScaleComp25 from '../components/_scale/ScaleComp25.vue';
import ScaleComp26 from '../components/_scale/ScaleComp26.vue';
import ScaleComp27 from '../components/_scale/ScaleComp27.vue';
import ScaleComp28 from '../components/_scale/ScaleComp28.vue';
import ScaleComp29 from '../components/_scale/ScaleComp29.vue';
import ScaleComp30 from '../components/_scale/ScaleComp30.vue';
import ScaleComp31 from '../components/_scale/ScaleComp31.vue';
import ScaleComp32 from '../components/_scale/ScaleComp32.vue';
import ScaleComp33 from '../components/_scale/ScaleComp33.vue';
import ScaleComp34 from '../components/_scale/ScaleComp34.vue';
import ScaleComp35 from '../components/_scale/ScaleComp35.vue';
import ScaleComp36 from '../components/_scale/ScaleComp36.vue';
import ScaleComp37 from '../components/_scale/ScaleComp37.vue';
import ScaleComp38 from '../components/_scale/ScaleComp38.vue';
import ScaleComp39 from '../components/_scale/ScaleComp39.vue';
import ScaleComp40 from '../components/_scale/ScaleComp40.vue';
import ScaleComp41 from '../components/_scale/ScaleComp41.vue';
import ScaleComp42 from '../components/_scale/ScaleComp42.vue';
import ScaleComp43 from '../components/_scale/ScaleComp43.vue';
import ScaleComp44 from '../components/_scale/ScaleComp44.vue';
import ScaleComp45 from '../components/_scale/ScaleComp45.vue';
import ScaleComp46 from '../components/_scale/ScaleComp46.vue';
import ScaleComp47 from '../components/_scale/ScaleComp47.vue';
import ScaleComp48 from '../components/_scale/ScaleComp48.vue';
import ScaleComp49 from '../components/_scale/ScaleComp49.vue';

const props = defineProps<{
	initialCount: number;
}>();

const count = ref(props.initialCount);
const isOpen = ref(false);
</script>

<template>
	<header>
		<a href="/">AbsoluteJS</a>
		<details
			:open="isOpen"
			@pointerenter="isOpen = true"
			@pointerleave="isOpen = false"
		>
			<summary>Pages</summary>
			<nav>
				<a href="/html">HTML</a>
				<a href="/react">React</a>
				<a href="/htmx">HTMX</a>
				<a href="/svelte">Svelte</a>
				<a href="/vue">Vue</a>
				<a href="/angular">Angular</a>
			</nav>
		</details>
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
			<a href="https://vuejs.org" target="_blank">
				<img
					class="logo vue"
					src="/assets/svg/vue-logo.svg"
					alt="Vue Logo"
				/>
			</a>
		</nav>
		<h1>AbsoluteJS + Vue</h1>
		<CountButton :initialCount="count" />
		<div data-scale-grid>
			<ScaleComp0 />
			<ScaleComp1 />
			<ScaleComp2 />
			<ScaleComp3 />
			<ScaleComp4 />
			<ScaleComp5 />
			<ScaleComp6 />
			<ScaleComp7 />
			<ScaleComp8 />
			<ScaleComp9 />
			<ScaleComp10 />
			<ScaleComp11 />
			<ScaleComp12 />
			<ScaleComp13 />
			<ScaleComp14 />
			<ScaleComp15 />
			<ScaleComp16 />
			<ScaleComp17 />
			<ScaleComp18 />
			<ScaleComp19 />
			<ScaleComp20 />
			<ScaleComp21 />
			<ScaleComp22 />
			<ScaleComp23 />
			<ScaleComp24 />
			<ScaleComp25 />
			<ScaleComp26 />
			<ScaleComp27 />
			<ScaleComp28 />
			<ScaleComp29 />
			<ScaleComp30 />
			<ScaleComp31 />
			<ScaleComp32 />
			<ScaleComp33 />
			<ScaleComp34 />
			<ScaleComp35 />
			<ScaleComp36 />
			<ScaleComp37 />
			<ScaleComp38 />
			<ScaleComp39 />
			<ScaleComp40 />
			<ScaleComp41 />
			<ScaleComp42 />
			<ScaleComp43 />
			<ScaleComp44 />
			<ScaleComp45 />
			<ScaleComp46 />
			<ScaleComp47 />
			<ScaleComp48 />
			<ScaleComp49 />
		</div>
		<p>
			Edit <code>example/vue/pages/VueExample.vue</code> and save to test
			HMR.
		</p>
		<p style="margin-top: 2rem">
			Explore the other pages to see how AbsoluteJS seamlessly unifies
			multiple frameworks on a single server.
		</p>
		<p style="color: #777; font-size: 1rem; margin-top: 2rem">
			Click on the AbsoluteJS and Vue logos to learn more.
		</p>
	</main>
</template>

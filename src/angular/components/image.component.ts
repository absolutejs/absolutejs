import { Component, computed, input, signal } from '@angular/core';
import type { ImageLoader } from '../../../types/image';
import {
	DEFAULT_QUALITY,
	buildOptimizedUrl,
	generateBlurSvg,
	generateSrcSet
} from '../../utils/imageProcessing';

/** Resolve the blur background CSS value from placeholder config */
const resolveBlurBg = (
	placeholderValue: string,
	blurDataUrl: string | undefined
) => {
	if (
		typeof placeholderValue === 'string' &&
		placeholderValue !== 'blur' &&
		placeholderValue.startsWith('data:')
	) {
		return generateBlurSvg(placeholderValue);
	}

	if (blurDataUrl) return generateBlurSvg(blurDataUrl);

	return undefined;
};

@Component({
	selector: 'abs-image',
	standalone: true,
	template: `
		@if (priority()) {
			<link
				rel="preload"
				as="image"
				[attr.href]="resolvedSrc()"
				[attr.imagesrcset]="srcSet()"
				[attr.imagesizes]="resolvedSizes()"
				[attr.crossorigin]="crossOrigin()"
			/>
		}
		@if (fill()) {
			<span style="position:relative;overflow:hidden;display:block;width:100%;height:100%">
				<img
					[alt]="alt()"
					[src]="resolvedSrc()"
					[srcset]="srcSet()"
					[sizes]="resolvedSizes()"
					[loading]="resolvedLoading()"
					[class]="className()"
					[ngStyle]="imgStyle()"
					[crossOrigin]="crossOrigin()"
					[referrerPolicy]="referrerPolicy()"
					[attr.fetchpriority]="resolvedFetchPriority()"
					decoding="async"
					(load)="handleLoad($event)"
					(error)="handleError($event)"
				/>
			</span>
		} @else {
			<img
				[alt]="alt()"
				[src]="resolvedSrc()"
				[srcset]="srcSet()"
				[sizes]="resolvedSizes()"
				[width]="width()"
				[height]="height()"
				[loading]="resolvedLoading()"
				[class]="className()"
				[ngStyle]="imgStyle()"
				[crossOrigin]="crossOrigin()"
				[referrerPolicy]="referrerPolicy()"
				[attr.fetchpriority]="resolvedFetchPriority()"
				decoding="async"
				(load)="handleLoad($event)"
				(error)="handleError($event)"
			/>
		}
	`
})
export class ImageComponent {
	// ── Inputs ──────────────────────────────────────────────────
	readonly alt = input.required<string>();
	readonly blurDataURL = input<string>();
	readonly className = input<string>();
	readonly crossOrigin = input<'anonymous' | 'use-credentials' | ''>();
	readonly fetchPriority = input<'high' | 'low' | 'auto'>();
	readonly fill = input(false);
	readonly height = input<number>();
	readonly loader = input<ImageLoader>();
	readonly loading = input<'lazy' | 'eager'>('lazy');
	readonly onError = input<((event: Event) => void)>();
	readonly onLoad = input<((event: Event) => void)>();
	readonly overrideSrc = input<string>();
	readonly placeholder = input<'blur' | 'empty' | string>('empty');
	readonly priority = input(false);
	readonly quality = input(DEFAULT_QUALITY);
	readonly referrerPolicy = input<string>();
	readonly sizes = input<string>();
	readonly src = input.required<string>();
	readonly style = input<Record<string, string | number>>();
	readonly unoptimized = input(false);
	readonly width = input<number>();

	// ── Internal state ──────────────────────────────────────────
	private readonly blurRemoved = signal(false);

	// ── Computed ────────────────────────────────────────────────
	readonly resolvedSrc = computed(() => {
		const override = this.overrideSrc();

		if (override) return override;

		if (this.unoptimized()) return this.src();

		const loaderFn = this.loader();

		if (loaderFn) return loaderFn({ quality: this.quality(), src: this.src(), width: this.width() ?? 0 });

		const currentWidth = this.width();

		if (!currentWidth) return buildOptimizedUrl(this.src(), 0, this.quality());

		return buildOptimizedUrl(this.src(), currentWidth, this.quality());
	});

	readonly srcSet = computed(() =>
		this.unoptimized()
			? undefined
			: generateSrcSet(this.src(), this.width(), this.sizes(), undefined, this.loader() ?? undefined)
	);

	readonly resolvedSizes = computed(() =>
		this.sizes() ?? (this.fill() ? '100vw' : undefined)
	);

	readonly resolvedLoading = computed(() =>
		this.priority() ? 'eager' as const : this.loading()
	);

	readonly resolvedFetchPriority = computed(() =>
		this.priority() ? 'high' : this.fetchPriority()
	);

	readonly imgStyle = computed(() => {
		const base: Record<string, string | number> = {
			...(this.style() ?? {}),
			color: 'transparent'
		};

		const hasBlur =
			!this.blurRemoved() &&
			(this.placeholder() === 'blur' ||
				(typeof this.placeholder() === 'string' &&
					this.placeholder() !== 'empty' &&
					(this.placeholder() ?? '').startsWith('data:')));

		const blurValue = hasBlur
			? resolveBlurBg(this.placeholder(), this.blurDataURL())
			: undefined;

		if (blurValue) {
			base['background-image'] = blurValue;
			base['background-position'] = 'center';
			base['background-repeat'] = 'no-repeat';
			base['background-size'] = 'cover';
		}

		if (this.fill()) {
			base.height = '100%';
			base.inset = '0';
			base['object-fit'] = 'cover';
			base.position = 'absolute';
			base.width = '100%';
		}

		return base;
	});

	// ── Event handlers ──────────────────────────────────────────
	handleLoad(event: Event) {
		this.blurRemoved.set(true);

		const callback = this.onLoad();

		if (callback) callback(event);
	}

	handleError(event: Event) {
		const callback = this.onError();

		if (callback) callback(event);
	}
}

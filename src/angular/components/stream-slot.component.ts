import {
	ChangeDetectionStrategy,
	ChangeDetectorRef,
	Component,
	Input,
	NgZone,
	inject,
	signal
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import {
	isStreamingSlotCollectionActive,
	registerStreamingSlot,
	warnMissingStreamingSlotCollector
} from '../../core/streamingSlotRegistrar';

type SlotResolver = () => Promise<string> | string;

type SlotConsumer = (payload: unknown) => boolean | void;

type AbsoluteSlotWindow = Window & {
	__ABS_SLOT_CONSUMERS__?: Record<string, SlotConsumer | undefined>;
	__ABS_SLOT_PENDING__?: Record<string, unknown>;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object';

const isHtmlPayload = (payload: unknown): payload is { html: string } =>
	isObjectRecord(payload) && typeof payload.html === 'string';

const resolvePayloadHtml = (payload: unknown) => {
	if (isHtmlPayload(payload)) {
		return payload.html;
	}

	return typeof payload === 'string' ? payload : '';
};

@Component({
	changeDetection: ChangeDetectionStrategy.OnPush,
	selector: 'abs-stream-slot',
	standalone: true,
	template: `
		<div
			[attr.id]="id"
			[attr.class]="className"
			data-absolute-raw-slot="true"
			data-absolute-slot="true"
			[innerHTML]="currentHtml()"
		></div>
	`
})
export class StreamSlotComponent {
	private readonly cdr = inject(ChangeDetectorRef);
	private readonly sanitizer = inject(DomSanitizer);
	private readonly zone = inject(NgZone);
	private readonly slotConsumer = (payload: unknown) => {
		this.zone.run(() => {
			this.currentHtml.set(
				this.sanitizer.bypassSecurityTrustHtml(
					resolvePayloadHtml(payload)
				)
			);
			this.cdr.markForCheck();
		});

		return true;
	};

	@Input() className?: string;
	@Input() errorHtml?: string;
	@Input() fallbackHtml = '';
	@Input({ required: true }) id!: string;
	@Input({ required: true }) resolve!: SlotResolver;
	@Input() timeoutMs?: number;
	readonly currentHtml = signal<SafeHtml | string>('');

	ngOnInit() {
		if (isStreamingSlotCollectionActive()) {
			this.currentHtml.set(
				this.sanitizer.bypassSecurityTrustHtml(this.fallbackHtml)
			);

			registerStreamingSlot({
				errorHtml: this.errorHtml,
				fallbackHtml: this.fallbackHtml,
				id: this.id,
				resolve: this.resolve,
				timeoutMs: this.timeoutMs
			});

			return;
		}
		warnMissingStreamingSlotCollector('StreamSlot');
		if (typeof window === 'undefined') {
			this.currentHtml.set(
				this.sanitizer.bypassSecurityTrustHtml(this.fallbackHtml)
			);

			return;
		}

		const absoluteWindow: AbsoluteSlotWindow = window;
		const consumers = (absoluteWindow.__ABS_SLOT_CONSUMERS__ =
			absoluteWindow.__ABS_SLOT_CONSUMERS__ ?? {});
		consumers[this.id] = this.slotConsumer;
		this.currentHtml.set(
			this.sanitizer.bypassSecurityTrustHtml(this.fallbackHtml)
		);
		const pendingPayload = absoluteWindow.__ABS_SLOT_PENDING__?.[this.id];
		if (pendingPayload !== undefined) {
			this.slotConsumer(pendingPayload);
			delete absoluteWindow.__ABS_SLOT_PENDING__?.[this.id];
		}
	}

	ngOnDestroy() {
		if (typeof window === 'undefined') return;

		const absoluteWindow: AbsoluteSlotWindow = window;
		if (absoluteWindow.__ABS_SLOT_CONSUMERS__) {
			delete absoluteWindow.__ABS_SLOT_CONSUMERS__[this.id];
		}
	}
}

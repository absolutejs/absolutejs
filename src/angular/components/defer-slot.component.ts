import {
	ChangeDetectionStrategy,
	ChangeDetectorRef,
	type AfterViewInit,
	Component,
	ContentChild,
	Input,
	inject,
	signal
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
	isStreamingSlotCollectionActive,
	registerStreamingSlot,
	warnMissingStreamingSlotCollector
} from '../../core/streamingSlotRegistrar';
import {
	type AngularDeferSlotPayload,
	isAngularDeferSlotPayload
} from './defer-slot-payload';
import {
	type DeferSlotTemplateContext,
	DeferErrorTemplateDirective,
	DeferFallbackTemplateDirective,
	DeferResolvedTemplateDirective
} from './defer-slot-templates.directive';

type DeferSlotResolver = () => Promise<AngularDeferSlotPayload>;

type DeferSlotState = 'error' | 'fallback' | 'resolved';

type SlotConsumer = (payload: unknown) => boolean | void;

type AbsoluteSlotWindow = Window & {
	__ABS_SLOT_CONSUMERS__?: Record<string, SlotConsumer | undefined>;
	__ABS_SLOT_FLUSH__?: () => void;
};

@Component({
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [
		NgTemplateOutlet,
		DeferResolvedTemplateDirective,
		DeferFallbackTemplateDirective,
		DeferErrorTemplateDirective
	],
	selector: 'abs-defer-slot',
	standalone: true,
	template: `
		<div [attr.id]="id" [attr.class]="className" data-absolute-slot="true">
			<ng-container
				[ngTemplateOutlet]="activeTemplate()"
				[ngTemplateOutletContext]="templateContext()"
			></ng-container>
		</div>
	`
})
export class DeferSlotComponent implements AfterViewInit {
	private readonly cdr = inject(ChangeDetectorRef);
	private readonly runtimeReady = signal(false);
	private serverSlotRegistered = false;

	@Input() className?: string;
	@Input() id = '';
	@Input() resolve?: DeferSlotResolver;
	@ContentChild(DeferResolvedTemplateDirective)
	resolvedTemplate?: DeferResolvedTemplateDirective;
	@ContentChild(DeferFallbackTemplateDirective)
	fallbackTemplate?: DeferFallbackTemplateDirective;
	@ContentChild(DeferErrorTemplateDirective)
	errorTemplate?: DeferErrorTemplateDirective;
	readonly slotData = signal<Record<string, string>>({});
	readonly state = signal<DeferSlotState>('fallback');

	readonly activeTemplate = () => {
		if (this.state() === 'resolved') {
			return this.resolvedTemplate?.templateRef ?? null;
		}

		if (this.state() === 'error') {
			return (
				this.errorTemplate?.templateRef ??
				this.fallbackTemplate?.templateRef ??
				null
			);
		}

		return (
			this.fallbackTemplate?.templateRef ??
			this.resolvedTemplate?.templateRef ??
			null
		);
	};

	readonly templateContext = (): DeferSlotTemplateContext => {
		const slotData = this.slotData();

		return {
			$implicit: slotData,
			slotData
		};
	};

	ngOnInit() {
		const { id } = this;
		if (!id) return;

		if (this.registerServerSlot()) {
			return;
		}

		const absoluteWindow: AbsoluteSlotWindow = window;
		const consumers = (absoluteWindow.__ABS_SLOT_CONSUMERS__ =
			absoluteWindow.__ABS_SLOT_CONSUMERS__ ?? {});
		consumers[id] = (payload) => {
			if (!this.runtimeReady()) return false;
			this.applyPatchPayload(payload);

			return true;
		};
	}

	ngAfterViewInit() {
		if (this.registerServerSlot()) return;
		if (typeof window === 'undefined') return;

		requestAnimationFrame(() => {
			this.runtimeReady.set(true);
			this.cdr.markForCheck();
			const absoluteWindow: AbsoluteSlotWindow = window;
			absoluteWindow.__ABS_SLOT_FLUSH__?.();
		});
	}

	ngOnDestroy() {
		if (typeof window === 'undefined') return;
		const { id } = this;
		if (!id) return;
		const absoluteWindow: AbsoluteSlotWindow = window;
		delete absoluteWindow.__ABS_SLOT_CONSUMERS__?.[id];
	}

	private registerServerSlot() {
		const { id, resolve } = this;
		if (this.serverSlotRegistered || !id || !resolve) {
			return false;
		}
		if (!isStreamingSlotCollectionActive()) {
			warnMissingStreamingSlotCollector('DeferSlot');

			return false;
		}

		registerStreamingSlot({
			id,
			resolve
		});
		this.serverSlotRegistered = true;

		return true;
	}

	private applyPatchPayload(payload: unknown) {
		if (payload === null || typeof payload === 'undefined') return;

		if (isAngularDeferSlotPayload(payload)) {
			const data =
				payload.data && typeof payload.data === 'object'
					? payload.data
					: {};
			this.slotData.set(data);
			this.state.set(payload.state === 'error' ? 'error' : 'resolved');
			this.cdr.markForCheck();

			return;
		}

		this.slotData.set({});
		this.state.set(payload === '' ? 'fallback' : 'resolved');
		this.cdr.markForCheck();
	}
}

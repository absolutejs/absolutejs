import { Directive, TemplateRef, inject } from '@angular/core';

export type DeferSlotTemplateContext = {
	$implicit: Record<string, string>;
	slotData: Record<string, string>;
};

@Directive({
	selector: 'ng-template[absDeferError]',
	standalone: true
})
export class DeferErrorTemplateDirective {
	readonly templateRef = inject<TemplateRef<unknown>>(TemplateRef);
}

@Directive({
	selector: 'ng-template[absDeferFallback]',
	standalone: true
})
export class DeferFallbackTemplateDirective {
	readonly templateRef = inject<TemplateRef<unknown>>(TemplateRef);
}

@Directive({
	selector: 'ng-template[absDeferResolved]',
	standalone: true
})
export class DeferResolvedTemplateDirective {
	readonly templateRef =
		inject<TemplateRef<DeferSlotTemplateContext>>(TemplateRef);
}

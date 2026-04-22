import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { mountRAGAPIShowcase } from '../../shared/ragApiShowcase';

@Component({
	selector: 'app-rag-showcase',
	standalone: true,
	template: `<div #host></div>`
})
export class RAGShowcaseComponent implements AfterViewInit {
	@ViewChild('host', { static: true }) host?: ElementRef<HTMLDivElement>;

	ngAfterViewInit() {
		if (this.host?.nativeElement) {
			mountRAGAPIShowcase(this.host.nativeElement);
		}
	}
}

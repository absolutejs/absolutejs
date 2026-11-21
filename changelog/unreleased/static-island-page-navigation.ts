import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "A static page carrying islands could be soft-navigated to but not from: the link out did a full document load. Marking a page as having nothing to tear down was keyed on the incoming document having no module script, and an island bootstrap is a module script, so such a page read as a framework page whose hydration index might still register a teardown hook — and the conservative full load is right for that case. It is now keyed on `__ABSOLUTE_PAGE_READY__`, which every hydration index sets as its module evaluates and an island bootstrap never sets: neither that nor a dispose hook present means there is no framework app at all. The mark also moved before `waitForPageReady`, which spends its whole poll deadline establishing that no hook is coming; marked after it, a static page stayed unswappable for seconds, long enough for a visitor's click to force the full load even once the signal was right. A page whose inline bootstrap imports its index asynchronously is marked too, which is safe because the mark never replaces a real hook and the index overwrites it on evaluation.",
	kind: 'fixed',
	summary: 'A static page with islands can be navigated away from in place'
};

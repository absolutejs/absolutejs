/* HMR notification toast — bottom-right corner, fades in for ~2.5s.
 *
 * Used when the Angular HMR client falls through to a full reboot, so
 * the developer can SEE why a save triggered a reboot instead of
 * silently watching the splash transition. The reason string comes
 * from the server-side classifier (`src/dev/angular/editTypeDetection`),
 * surfaced via the `reason` field on the HMR wire message.
 *
 * Mounts a single shared container the first time it's called and
 * stacks toasts inside it. Each toast removes itself after the visible
 * window expires; the container stays mounted for the session. */

const CONTAINER_ID = '__abs_hmr_toast_container__';
const VISIBLE_DURATION_MS = 2500;
const FADE_MS = 220;

const ensureContainer = (): HTMLDivElement => {
	const existing = document.getElementById(
		CONTAINER_ID
	) as HTMLDivElement | null;
	if (existing) return existing;

	const container = document.createElement('div');
	container.id = CONTAINER_ID;
	Object.assign(container.style, {
		position: 'fixed',
		bottom: '16px',
		right: '16px',
		display: 'flex',
		flexDirection: 'column',
		gap: '8px',
		zIndex: '2147483646',
		pointerEvents: 'none',
		fontFamily:
			'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
		fontSize: '12px',
		maxWidth: '420px'
	});
	document.body.appendChild(container);

	return container;
};

const accentForType = (updateType: string | undefined): string => {
	switch (updateType) {
		case 'route':
			return '#1d4ed8';
		case 'service-with-side-effects':
			return '#b45309';
		case 'reboot':
		default:
			return '#dd0031';
	}
};

export type HmrToastInput = {
	updateType?: string;
	reason?: string;
	editSourceFile?: string;
};

export const showHmrToast = ({
	updateType,
	reason,
	editSourceFile
}: HmrToastInput) => {
	if (typeof document === 'undefined') return;
	const container = ensureContainer();

	const toast = document.createElement('div');
	const accent = accentForType(updateType);
	Object.assign(toast.style, {
		background: 'rgba(15, 17, 22, 0.94)',
		color: '#f8fafc',
		borderLeft: `3px solid ${accent}`,
		padding: '8px 12px',
		borderRadius: '6px',
		boxShadow: '0 6px 24px rgba(0, 0, 0, 0.35)',
		opacity: '0',
		transform: 'translateY(6px)',
		transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`,
		pointerEvents: 'auto',
		whiteSpace: 'nowrap',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		maxWidth: '420px'
	});

	const label = document.createElement('div');
	Object.assign(label.style, {
		color: accent,
		fontWeight: '600',
		marginBottom: '2px',
		letterSpacing: '0.02em'
	});
	label.textContent = `HMR reboot — ${updateType ?? 'unknown'}`;
	toast.appendChild(label);

	const body = document.createElement('div');
	Object.assign(body.style, {
		color: '#cbd5e1',
		whiteSpace: 'normal',
		wordBreak: 'break-word'
	});
	body.textContent = reason ?? '(no reason given)';
	toast.appendChild(body);

	if (editSourceFile) {
		const path = document.createElement('div');
		Object.assign(path.style, {
			color: '#64748b',
			marginTop: '2px',
			fontSize: '11px',
			whiteSpace: 'nowrap',
			overflow: 'hidden',
			textOverflow: 'ellipsis'
		});
		// Format like the server logger does: relative + leading slash.
		const cwdLike = editSourceFile.replace(/^.*?(\/src\/|\/pages\/)/, '$1');
		path.textContent = cwdLike;
		toast.appendChild(path);
	}

	container.appendChild(toast);

	// Trigger CSS transition by deferring to the next paint.
	requestAnimationFrame(() => {
		toast.style.opacity = '1';
		toast.style.transform = 'translateY(0)';
	});

	const removeAt = window.setTimeout(() => {
		toast.style.opacity = '0';
		toast.style.transform = 'translateY(6px)';
		window.setTimeout(() => {
			if (toast.parentNode) toast.parentNode.removeChild(toast);
		}, FADE_MS);
	}, VISIBLE_DURATION_MS);

	// If the user clicks the toast, dismiss it immediately.
	toast.addEventListener('click', () => {
		window.clearTimeout(removeAt);
		toast.style.opacity = '0';
		toast.style.transform = 'translateY(6px)';
		window.setTimeout(() => {
			if (toast.parentNode) toast.parentNode.removeChild(toast);
		}, FADE_MS);
	});
};

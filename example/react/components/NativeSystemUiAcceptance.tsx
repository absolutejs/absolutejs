import { keyboard, systemBars } from '@absolutejs/devices';
import { useEffect, useState } from 'react';

const errorCode = (error: unknown) => {
	if (typeof error === 'object' && error !== null) {
		const code = Reflect.get(error, 'code');
		if (typeof code === 'string') return code;
	}

	return 'unknown';
};

export const NativeSystemUiAcceptance = () => {
	const [bars, setBars] = useState('not-queried');
	const [detail, setDetail] = useState('Ready');
	const [error, setError] = useState('none');
	const [keyboardState, setKeyboardState] = useState('hidden:0');
	const [keyboardEvents, setKeyboardEvents] = useState({
		hidden: 0,
		visible: 0
	});

	useEffect(() => {
		let active = true;
		let remove: (() => void | Promise<void>) | undefined;
		void keyboard
			.onChange(({ heightPx, visible }) => {
				if (active) {
					setKeyboardState(
						`${visible ? 'visible' : 'hidden'}:${heightPx}`
					);
					setKeyboardEvents((current) => ({
						hidden: current.hidden + (visible ? 0 : 1),
						visible: current.visible + (visible ? 1 : 0)
					}));
				}
			})
			.then((subscription) => {
				remove = subscription;

				return subscription;
			})
			.catch((caught) => {
				if (active) setError(errorCode(caught));
			});

		return () => {
			active = false;
			void remove?.();
		};
	}, []);

	const run = async (action: () => Promise<void>, success: string) => {
		try {
			await action();
			setDetail(success);
			setError('none');
		} catch (caught) {
			setDetail(`${success} failed`);
			setError(errorCode(caught));
		}
	};

	return (
		<main>
			<h1>AbsoluteJS System UI</h1>
			<p id="system-ui-detail">{detail}</p>
			<dl id="system-ui-status">
				<dt>Keyboard</dt>
				<dd
					data-keyboard={keyboardState}
					data-keyboard-hidden-events={keyboardEvents.hidden}
					data-keyboard-visible-events={keyboardEvents.visible}
				>
					{keyboardState}
				</dd>
				<dt>System bars</dt>
				<dd data-system-bars={bars}>{bars}</dd>
				<dt>Error</dt>
				<dd data-error={error}>{error}</dd>
			</dl>
			<label>
				Keyboard fixture
				<input
					id="system-ui-input"
					placeholder="Focus to open keyboard"
				/>
			</label>
			<button
				id="system-ui-query"
				onClick={() =>
					void run(async () => {
						const [keyboardCapability, barsCapability] =
							await Promise.all([
								keyboard.capability(),
								systemBars.capability()
							]);
						if (keyboardCapability.available) {
							const state = await keyboard.getState();
							setKeyboardState(
								state.visible
									? `visible:${state.heightPx}`
									: 'hidden:0'
							);
						} else setKeyboardState(keyboardCapability.reason);
						setBars(
							barsCapability.available
								? barsCapability.fidelity
								: barsCapability.reason
						);
					}, 'System UI queried')
				}
			>
				Query capabilities
			</button>
			<button
				id="system-ui-dismiss"
				onClick={() =>
					void run(() => keyboard.dismiss(), 'Keyboard dismissed')
				}
			>
				Dismiss keyboard
			</button>
			<button
				id="system-ui-light"
				onClick={() =>
					void run(
						() => systemBars.setAppearance('light'),
						'Light foreground applied'
					)
				}
			>
				Light system-bar foreground
			</button>
			<button
				id="system-ui-dark"
				onClick={() =>
					void run(
						() => systemBars.setAppearance('dark'),
						'Dark foreground applied'
					)
				}
			>
				Dark system-bar foreground
			</button>
			<button
				id="system-ui-hide-status"
				onClick={() =>
					void run(
						() => systemBars.setVisible(false, 'status'),
						'Status bar hidden'
					)
				}
			>
				Hide status bar
			</button>
			<button
				id="system-ui-show"
				onClick={() =>
					void run(
						() => systemBars.setVisible(true),
						'System bars shown'
					)
				}
			>
				Show system bars
			</button>
		</main>
	);
};

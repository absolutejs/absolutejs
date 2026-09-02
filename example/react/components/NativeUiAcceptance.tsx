export const NativeUiAcceptance = () => (
	<div data-absolute-app-shell id="mobile-ui-shell">
		<header data-absolute-app-header>
			<h1>AbsoluteJS mobile UI</h1>
			<button data-absolute-sheet-open="mobile-ui-sheet" id="open-sheet">
				Open sheet
			</button>
		</header>
		<main data-absolute-app-main>
			<section
				data-absolute-navigation-stack
				id="mobile-ui-stack"
				style={{ minHeight: '140vh' }}
			>
				<h2>Navigation stack</h2>
				<p>
					This standard HTML is enhanced by the framework-neutral
					mobile UI runtime.
				</p>
				<label>
					State preservation fixture
					<input
						defaultValue="kept while sheet opens"
						id="mobile-ui-input"
					/>
				</label>
				<input
					aria-label="Credential restoration exclusion fixture"
					defaultValue="never retained by navigation"
					id="mobile-ui-password"
					type="password"
				/>
				<p>
					<a
						data-absolute-link="back"
						href="/react"
						id="mobile-ui-back"
					>
						Back
					</a>
				</p>
				<p>
					<a
						data-absolute-link="external"
						href="https://absolutejs.com"
						id="mobile-ui-external"
					>
						Open AbsoluteJS externally
					</a>
				</p>
			</section>
		</main>
		<nav aria-label="Primary" data-absolute-tab-bar id="mobile-ui-tabs">
			<a href="/react">React</a>
			<a href="/native-ui">Mobile UI</a>
		</nav>
		<dialog
			aria-labelledby="mobile-ui-sheet-title"
			data-absolute-sheet
			id="mobile-ui-sheet"
		>
			<h2 id="mobile-ui-sheet-title">Framework-neutral sheet</h2>
			<p>
				Escape, Android Back, the backdrop, or Done closes this sheet.
			</p>
			<button data-absolute-sheet-close id="close-sheet">
				Done
			</button>
		</dialog>
	</div>
);

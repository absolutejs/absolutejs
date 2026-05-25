// Always throws to stress-test render-error handling; `: never` keeps it a valid
// ReactComponent for the typechecker (never is assignable to ReactNode).
export function BoomPage(): never {
	throw new Error('BOOM_PAGE_FAILURE');
}

// Reject anything that isn't a same-origin path, including protocol-relative
// `//evil` and full URLs, to defuse open-redirect via the `redir` query param.
export function sanitizeRedirectPath(redirectPath: string | null | undefined, fallback: string) {
	if (!redirectPath) return fallback;
	if (!redirectPath.startsWith("/") || redirectPath.startsWith("//")) return fallback;
	return redirectPath;
}

// Reject anything that isn't a same-origin path. Defuses open-redirect via the
// `redir` query param. Covers full URLs, protocol-relative `//evil`, and the
// backslash variant `/\evil` that some browsers normalize to `//evil`.
export function sanitizeRedirectPath(redirectPath: string | null | undefined, fallback: string) {
	if (!redirectPath) return fallback;
	if (!redirectPath.startsWith("/")) return fallback;
	if (redirectPath.startsWith("//") || redirectPath.startsWith("/\\")) return fallback;
	return redirectPath;
}

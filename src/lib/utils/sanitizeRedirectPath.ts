// Reject anything that isn't a same-origin path. Defuses open-redirect via the
// `redir` query param. Covers full URLs, protocol-relative `//evil`, the
// backslash variant `/\evil` that some browsers normalize to `//evil`, and
// CRLF/control-char header-injection attempts inside Location.
export function sanitizeRedirectPath(redirectPath: string | null | undefined, fallback: string) {
	if (!redirectPath) return fallback;
	if (!redirectPath.startsWith("/")) return fallback;
	if (redirectPath.startsWith("//")) return fallback;
	// Reject control chars (U+0000–U+001F) and backslashes anywhere — browsers
	// normalize `\` to `/`, so `/foo\evil.com` could become `//evil.com`.
	if (/[\x00-\x1f\\]/.test(redirectPath)) return fallback;
	return redirectPath;
}

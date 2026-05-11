import { authBaseUrl, isAuthFeatureEnabled, signInWithDiscord } from "@/lib/server/auth/betterAuth";
import { getClientConfig } from "@/lib/services/config/config.server";
import { getMapPath } from "@/lib/utils/getMapPath";
import { sanitizeRedirectPath } from "@/lib/utils/sanitizeRedirectPath";
import { redirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";

export async function GET(event: RequestEvent): Promise<Response> {
	if (!isAuthFeatureEnabled()) return new Response(null, { status: 404 });

	const redirectPath = sanitizeRedirectPath(
		event.url.searchParams.get("redir"),
		getMapPath(getClientConfig())
	);

	// Same target for success and failure; Better Auth appends its own
	// `error=<code>` on failure and the callback page branches on it.
	const callbackURL = new URL("/login/discord/callback", authBaseUrl!);
	callbackURL.searchParams.set("redir", redirectPath);
	const callbackString = callbackURL.toString();

	const response = await signInWithDiscord(event, {
		callbackURL: callbackString,
		errorCallbackURL: callbackString
	});

	if (!response?.url) return new Response(null, { status: 500 });
	redirect(302, response.url);
}

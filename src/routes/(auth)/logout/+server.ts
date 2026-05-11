import type { RequestEvent } from "@sveltejs/kit";
import {
	getDiscordAccessToken,
	isAuthFeatureEnabled,
	revokeDiscordToken,
	signOut as signOutFromAuth
} from "@/lib/server/auth/betterAuth";
import { getServerLogger } from "@/lib/server/logging";

const authLogger = getServerLogger("auth");

async function handleSignOut(event: RequestEvent) {
	if (!isAuthFeatureEnabled()) return new Response(null, { status: 404 });

	if (!event.locals.session) return new Response(null, { status: 204 });

	const accessToken = await getDiscordAccessToken(event);
	if (accessToken) await revokeDiscordToken(accessToken);

	const didSignOut = await signOutFromAuth(event);
	if (!didSignOut) {
		authLogger.error("Better Auth sign-out failed", {
			path: event.url.pathname
		});
		return new Response(null, { status: 500 });
	}

	return new Response(null, { status: 204 });
}

export async function POST(event: RequestEvent): Promise<Response> {
	return handleSignOut(event);
}

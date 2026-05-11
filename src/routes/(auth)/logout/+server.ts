import type { RequestEvent } from "@sveltejs/kit";
import {
	getDiscordAccessToken,
	isAuthFeatureEnabled,
	revokeDiscordToken,
	signOut as signOutFromAuth
} from "@/lib/server/auth/betterAuth";
import { getServerLogger } from "@/lib/server/logging";

const authLogger = getServerLogger("auth");

export async function POST(event: RequestEvent): Promise<Response> {
	if (!isAuthFeatureEnabled()) return new Response(null, { status: 404 });

	// Already-signed-out is a successful no-op (idempotent).
	if (!event.locals.session) return new Response(null, { status: 204 });

	const accessToken = await getDiscordAccessToken(event);
	if (accessToken) await revokeDiscordToken(accessToken);

	const didSignOut = await signOutFromAuth(event);
	if (!didSignOut) {
		authLogger.error("Better Auth sign-out failed", { path: event.url.pathname });
		return new Response(null, { status: 500 });
	}

	return new Response(null, { status: 204 });
}

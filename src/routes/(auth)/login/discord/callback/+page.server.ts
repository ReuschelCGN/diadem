import type { PageServerLoad } from "./$types";
import { getClientConfig } from "@/lib/services/config/config.server";
import { getMapPath } from "@/lib/utils/getMapPath";
import { isAuthRequiredEnabled } from "@/lib/server/auth/betterAuth";
import { sanitizeRedirectPath } from "@/lib/utils/sanitizeRedirectPath";

export const load: PageServerLoad = async (event) => {
	const redir = sanitizeRedirectPath(
		event.url.searchParams.get("redir"),
		isAuthRequiredEnabled() ? "/" : getMapPath(getClientConfig())
	);

	if (event.url.searchParams.has("error")) {
		return { error: "Discord login failed", redir, name: "" };
	}

	if (!event.locals.authUser) {
		return { error: "Discord login completed but the session was not set", redir, name: "" };
	}

	// Don't fall through to email: it's the synthetic `<discord_id>@discord.diadem.local`.
	return { error: undefined, redir, name: event.locals.authUser.name || "" };
};

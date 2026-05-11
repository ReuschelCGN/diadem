import type { ParaglideLocals } from "@inlang/paraglide-sveltekit";
import type { AvailableLanguageTag } from "../../lib/paraglide/runtime";

import type { Perms } from "@/lib/utils/features";
import type { BetterAuthSessionData, BetterAuthUserData } from "@/lib/server/auth/betterAuth";
import type { User } from "@/lib/server/db/internal/schema";

declare global {
	namespace App {
		interface Locals {
			paraglide: ParaglideLocals<AvailableLanguageTag>;
			/** Diadem-side user row (permissions, userSettings). Null when unauthenticated. */
			user: User | null;
			/** Better Auth session row (id, expiry, ip). Null when unauthenticated. */
			session: BetterAuthSessionData | null;
			/** Better Auth user row (name, email, image, discordId). Null when unauthenticated. */
			authUser: BetterAuthUserData | null;
			perms: Perms;
		}
	}
}

export {};

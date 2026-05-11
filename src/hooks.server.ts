import { PERMISSION_UPDATE_INTERVAL } from "@/lib/constants";
import { locales, serverAsyncLocalStorage } from "@/lib/paraglide/runtime";
import { paraglideMiddleware } from "@/lib/paraglide/server";
import { getUserFromDiscordId } from "@/lib/server/auth/auth";
import {
	assertBetterAuthStartupReadiness,
	auth,
	getAuthSession,
	getDiscordAccessToken,
	isAuthFeatureEnabled
} from "@/lib/server/auth/betterAuth";
import { getEveryonePerms, updatePermissions } from "@/lib/server/auth/permissions";
import type { User } from "@/lib/server/db/internal/schema";
import { getServerLogger } from "@/lib/server/logging";
import { setConfig } from "@/lib/services/config/config";
import { getClientConfig } from "@/lib/services/config/config.server";
import { getDisallowedPaths } from "@/lib/utils/disallowedPaths";
import { setServerLoggerFactory } from "@/lib/utils/logger";
import TTLCache from "@isaacs/ttlcache";
import { building } from "$app/environment";
import type { Handle, ServerInit } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import { svelteKitHandler } from "better-auth/svelte-kit";

process.title = "Diadem";

const paraglideHandle: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request: localizedRequest, locale }) => {
		event.request = localizedRequest;

		// set locale for ssr metadata
		const langParam = event.url.searchParams.get("lang");
		const isValidLang = !!langParam && (locales as readonly string[]).includes(langParam);
		if (isValidLang) {
			const store = serverAsyncLocalStorage?.getStore();
			if (store) store.locale = langParam as (typeof locales)[number];
		}
		// Use the validated lang only — `effectiveLocale` is interpolated into
		// `<html lang="%lang%">` so any unvalidated value is reflected XSS.
		const effectiveLocale = isValidLang ? langParam! : locale;

		return resolve(event, {
			transformPageChunk: ({ html }) => html.replace("%lang%", effectiveLocale)
		});
	});

// Keyed by discordId. Stores the resolved User with up-to-date permissions.
// TTL'd so permissions and user row both refresh together; a single in-flight
// promise per discordId dedupes concurrent cold-cache requests.
const userCache: TTLCache<string, User> = new TTLCache({
	ttl: PERMISSION_UPDATE_INTERVAL * 1000
});
const userResolveInFlight = new Map<string, Promise<User>>();
const authLogger = getServerLogger("auth");

async function resolveUserAndPerms(event: Parameters<Handle>[0]["event"], discordId: string) {
	const cached = userCache.get(discordId);
	if (cached) return cached;

	let promise = userResolveInFlight.get(discordId);
	if (!promise) {
		promise = (async () => {
			const user = await getUserFromDiscordId(discordId);
			if (!user) {
				// Better Auth's mapProfileToUser inserts the user row before the session
				// becomes valid, so a session referencing a missing user means schema
				// corruption or a bypassed insert path.
				throw new Error(`No user row for authenticated discordId ${discordId}`);
			}
			const accessToken = await getDiscordAccessToken(event);
			user.permissions = await updatePermissions(user, accessToken ?? "", event.fetch);
			userCache.set(discordId, user);
			return user;
		})().finally(() => userResolveInFlight.delete(discordId));
		userResolveInFlight.set(discordId, promise);
	}
	return promise;
}

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	if (!auth) return resolve(event);
	return svelteKitHandler({ event, resolve, auth, building });
};

const handleAuth: Handle = async ({ event, resolve }) => {
	event.locals.perms = await getEveryonePerms(event.fetch);
	event.locals.user = null;
	event.locals.session = null;
	event.locals.authUser = null;

	if (!isAuthFeatureEnabled()) {
		return resolve(event);
	}

	const authSession = await getAuthSession(event);
	if (!authSession?.session || !authSession.user) {
		return resolve(event);
	}

	const discordId = authSession.user.discordId;
	if (!discordId) {
		authLogger.warning("Authenticated user has no discordId in Better Auth session");
		return resolve(event);
	}

	let user: User;
	try {
		user = await resolveUserAndPerms(event, discordId);
	} catch (error) {
		authLogger.error(`Failed to resolve user for discordId ${discordId}: ${error}`);
		return resolve(event);
	}

	event.locals.user = user;
	event.locals.session = authSession.session;
	event.locals.authUser = authSession.user;
	event.locals.perms = user.permissions;
	return resolve(event);
};

export const init: ServerInit = async () => {
	// set config for ssr
	const config = getClientConfig();
	setConfig(config);

	setServerLoggerFactory((name) => {
		const winstonLogger = getServerLogger(name);
		return {
			debug: (message, ...args) => winstonLogger.debug(message, ...args),
			info: (message, ...args) => winstonLogger.info(message, ...args),
			warning: (message, ...args) => winstonLogger.warning(message, ...args),
			error: (message, ...args) => winstonLogger.error(message, ...args),
			crit: (message, ...args) => winstonLogger.crit(message, ...args)
		};
	});

	await assertBetterAuthStartupReadiness();

	const { initDiadem } = await import("@/lib/server/init");
	await initDiadem();
};

const handleSeo: Handle = async ({ event, resolve }) => {
	const general = getClientConfig().general;

	return resolve(event, {
		transformPageChunk: ({ html }) => {
			const metaTags: string[] = [];

			const addMeta = (identifier: string, tag: string) => {
				if (!html.includes(identifier)) metaTags.push(tag);
			};

			const isNonindexPath = getDisallowedPaths().some((p) => event.url.pathname.startsWith(p));
			if (!general.allowCrawlers) {
				addMeta('name="robots"', '<meta name="robots" content="noindex, nofollow">');
			} else if (isNonindexPath) {
				addMeta('name="robots"', '<meta name="robots" content="noindex, follow">');
			} else {
				addMeta('name="robots"', '<meta name="robots" content="index, follow">');
			}

			if (general.description) {
				addMeta('name="description"', `<meta name="description" content="${general.description}">`);
				addMeta(
					'property="og:description"',
					`<meta property="og:description" content="${general.description}">`
				);
			}
			if (general.image) {
				addMeta('property="og:image"', `<meta property="og:image" content="${general.image}">`);
				addMeta(
					'name="twitter:image:src"',
					`<meta name="twitter:image:src" content="${general.image}">`
				);
				addMeta('name="twitter:card"', '<meta name="twitter:card" content="summary_large_image">');
			}
			if (general.url) {
				addMeta('rel="canonical"', `<link rel="canonical" href="${general.url}">`);
				addMeta('property="og:url"', `<meta property="og:url" content="${general.url}">`);
				if (!general.image) {
					addMeta(
						'property="og:image"',
						`<meta property="og:image" content="${general.url}/thumbnail.png">`
					);
					addMeta(
						'name="twitter:image:src"',
						`<meta name="twitter:image:src" content="${general.url}/thumbnail.png">`
					);
					addMeta(
						'name="twitter:card"',
						'<meta name="twitter:card" content="summary_large_image">'
					);
				}
			}

			addMeta('property="og:title"', `<meta property="og:title" content="${general.mapName}">`);
			addMeta('name="twitter:title"', `<meta name="twitter:title" content="${general.mapName}">`);
			addMeta(
				'property="og:site_name"',
				`<meta property="og:site_name" content="${general.mapName}">`
			);
			addMeta('name="twitter:site"', `<meta name="twitter:site" content="${general.mapName}">`);
			if (general.description) {
				addMeta(
					'name="twitter:description"',
					`<meta name="twitter:description" content="${general.description}">`
				);
			}
			addMeta('property="og:type"', '<meta property="og:type" content="website">');

			if (metaTags.length === 0) return html;
			return html.replace("</head>", metaTags.join("\n") + "\n</head>");
		}
	});
};

export const handle: Handle = sequence(paraglideHandle, handleBetterAuth, handleAuth, handleSeo);

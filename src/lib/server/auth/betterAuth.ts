import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { sveltekitCookies } from "better-auth/svelte-kit";
import { getRequestEvent } from "$app/server";
import type { RequestEvent } from "@sveltejs/kit";
import { getTableName, sql } from "drizzle-orm";

import { db } from "@/lib/server/db/internal";
import { account, session, user, verification } from "@/lib/server/db/internal/schema";
import { generateAuthRecordId } from "@/lib/server/auth/userRecord";
import { getServerConfig } from "@/lib/services/config/config.server";
import { getLogger } from "@/lib/utils/logger";

const log = getLogger("better-auth");

const authTables = [user, session, account, verification] as const;
const authConfig = getServerConfig().auth;
const discordConfig = authConfig.discord;
const discordClientId = discordConfig?.clientId?.trim();
const discordClientSecret = discordConfig?.clientSecret?.trim();
const rawAuthBaseUrl = authConfig.baseUrl?.trim();
const authSecret =
	authConfig.secret?.trim() ||
	process.env.BETTER_AUTH_SECRET?.trim() ||
	process.env.AUTH_SECRET?.trim();

const authErrors: string[] = [];

export const authBaseUrl = parseAuthBaseUrl(rawAuthBaseUrl, authErrors);

function parseAuthBaseUrl(raw: string | undefined, errors: string[]): string | null {
	if (!raw) {
		errors.push("server.auth.baseUrl is required");
		return null;
	}
	try {
		const parsed = new URL(raw);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
		return parsed.origin;
	} catch {
		errors.push("server.auth.baseUrl must be an absolute http(s) URL, e.g. https://map.co");
		return null;
	}
}

if (!authSecret) authErrors.push("server.auth.secret (or BETTER_AUTH_SECRET env) is required");
if (!discordClientId) authErrors.push("server.auth.discord.clientId is required");
if (!discordClientSecret) authErrors.push("server.auth.discord.clientSecret is required");

const isFeatureEnabled = Boolean(authConfig.enabled);
const canConstructAuth = isFeatureEnabled && authErrors.length === 0;

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const SESSION_REFRESH_SECONDS = 60 * 60 * 24 * 15; // 15 days

const isMissingTableError = (e: { code?: string; errno?: number } | null | undefined) =>
	e?.code === "ER_NO_SUCH_TABLE" || e?.errno === 1146;
const isMissingColumnError = (e: { code?: string; errno?: number } | null | undefined) =>
	e?.code === "ER_BAD_FIELD_ERROR" || e?.errno === 1054;

async function assertBetterAuthSchemaReady() {
	const missing: string[] = [];
	for (const t of authTables) {
		const tableName = getTableName(t);
		try {
			await db.execute(sql.raw(`SELECT 1 FROM \`${tableName}\` LIMIT 1`));
		} catch (error) {
			const e = error as { code?: string; errno?: number };
			if (isMissingTableError(e) || isMissingColumnError(e)) missing.push(tableName);
			else throw new Error(`[AUTH_STARTUP_ERROR] Schema probe failed: ${error}`);
		}
	}
	if (missing.length > 0) {
		throw new Error(
			`[AUTH_STARTUP_ERROR] Better Auth schema is incomplete. Missing tables: ${missing.join(", ")}. ` +
				"Run your DB migration before starting the app."
		);
	}
}

// Memoized so concurrent boot paths (e.g. multiple SvelteKit init hooks
// firing in a worker pool) share a single schema probe.
let startupReadinessPromise: Promise<void> | null = null;
export async function assertBetterAuthStartupReadiness() {
	if (!authConfig.enabled) return;
	if (authErrors.length > 0) {
		throw new Error(
			`[AUTH_STARTUP_ERROR] Better Auth config is invalid:\n  - ${authErrors.join("\n  - ")}\n` +
				"Set the values and restart, or set server.auth.enabled=false."
		);
	}
	if (!startupReadinessPromise) {
		startupReadinessPromise = assertBetterAuthSchemaReady();
	}
	await startupReadinessPromise;
}

export const auth = canConstructAuth
	? betterAuth({
			secret: authSecret!,
			baseURL: authBaseUrl!,
			basePath: "/api/auth",
			database: drizzleAdapter(db, {
				provider: "mysql",
				camelCase: true,
				usePlural: false,
				schema: {
					user,
					session,
					account,
					verification
				}
			}),
			trustedOrigins: [authBaseUrl!],
			advanced: {
				database: {
					generateId: () => generateAuthRecordId()
				}
			},
			session: {
				expiresIn: SESSION_TTL_SECONDS,
				updateAge: SESSION_REFRESH_SECONDS
			},
			account: {
				encryptOAuthTokens: true
			},
			user: {
				additionalFields: {
					discordId: {
						type: "string",
						required: true,
						unique: true,
						input: false,
						returned: true
					}
				}
			},
			socialProviders: {
				discord: {
					clientId: discordClientId!,
					clientSecret: discordClientSecret!,
					scope: ["identify", "guilds.members.read"],
					mapProfileToUser: (profile) => ({
						discordId: profile.id,
						name: profile.global_name || profile.username,
						// Better Auth needs a unique non-null email; we don't request the
						// `email` scope. The `.local` TLD ensures no system tries to deliver.
						email: `${profile.id}@discord.diadem.local`,
						emailVerified: true,
						image: profile.image_url || undefined
					})
				}
			},
			// `sveltekitCookies` must be the last plugin so it wraps the cookie-setting
			// flow of all other plugins. Uses SvelteKit's getRequestEvent() to call
			// event.cookies.set() automatically when Better Auth sets a cookie from a
			// server-side auth.api.* call.
			plugins: [sveltekitCookies(getRequestEvent)]
		})
	: null;

type AuthInstance = NonNullable<typeof auth>;
/** Better Auth's combined `{ session, user }` payload returned from getSession. */
export type BetterAuthSession = AuthInstance["$Infer"]["Session"];
/** Bare session row (id, expiry, ip, user agent). */
export type BetterAuthSessionData = BetterAuthSession["session"];
/** Bare auth-side user (name, email, image, plus our `discordId` additional field). */
export type BetterAuthUserData = BetterAuthSession["user"];

export const discordClientCredentials =
	discordClientId && discordClientSecret
		? { clientId: discordClientId, clientSecret: discordClientSecret }
		: null;

export function isAuthFeatureEnabled() {
	return isFeatureEnabled;
}

export function isAuthRequiredEnabled() {
	return isFeatureEnabled && !authConfig.optional;
}

type SignInSocialResult = { url?: string; redirect: boolean };

// Generic wrapper: returns null on auth-disabled or on any thrown error from
// Better Auth's server API. Logs at the requested level so callers don't each
// re-derive the failure mode.
async function callAuth<T>(
	label: string,
	level: "warning" | "error",
	fn: (a: AuthInstance) => Promise<T>
): Promise<T | null> {
	if (!auth) return null;
	try {
		return await fn(auth);
	} catch (error) {
		log[level](`${label} failed: ${error}`);
		return null;
	}
}

export function signInWithDiscord(
	event: RequestEvent,
	options: { callbackURL: string; errorCallbackURL: string }
): Promise<SignInSocialResult | null> {
	return callAuth(
		"Sign-in with Discord",
		"warning",
		(a) =>
			a.api.signInSocial({
				body: {
					provider: "discord",
					callbackURL: options.callbackURL,
					newUserCallbackURL: options.callbackURL,
					errorCallbackURL: options.errorCallbackURL,
					disableRedirect: true
				},
				headers: event.request.headers
			}) as Promise<SignInSocialResult>
	);
}

export async function signOut(event: RequestEvent): Promise<boolean> {
	const result = await callAuth("Sign-out", "warning", (a) =>
		a.api.signOut({ headers: event.request.headers })
	);
	return result !== null;
}

export function getAuthSession(event: RequestEvent): Promise<BetterAuthSession | null> {
	// `error` level: a failure here silently logs every user out — needs to page
	// rather than tail-log.
	return callAuth("Read auth session", "error", (a) =>
		a.api.getSession({ headers: event.request.headers })
	);
}

export async function getDiscordAccessToken(event: RequestEvent): Promise<string | null> {
	const result = await callAuth("Fetch Discord access token", "warning", (a) =>
		a.api.getAccessToken({
			headers: event.request.headers,
			body: { providerId: "discord" }
		})
	);
	return result?.accessToken ?? null;
}

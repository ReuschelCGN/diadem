import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { sveltekitCookies } from "better-auth/svelte-kit";
import { getRequestEvent } from "$app/server";
import type { RequestEvent } from "@sveltejs/kit";
import { getTableName, sql } from "drizzle-orm";

import { db } from "@/lib/server/db/internal";
import { account, session, user, verification } from "@/lib/server/db/internal/schema";
import { generateAuthRecordId } from "@/lib/server/auth/auth";
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
export type BetterAuthSession = AuthInstance["$Infer"]["Session"];
export type BetterAuthSessionData = BetterAuthSession["session"];
export type BetterAuthUserData = BetterAuthSession["user"];

export function isAuthFeatureEnabled() {
	return isFeatureEnabled;
}

export function isAuthRequiredEnabled() {
	return isFeatureEnabled && !authConfig.optional;
}

export async function signInWithDiscord(
	event: RequestEvent,
	options: { callbackURL: string; errorCallbackURL: string }
) {
	if (!auth) return null;
	try {
		return (await auth.api.signInSocial({
			body: {
				provider: "discord",
				callbackURL: options.callbackURL,
				newUserCallbackURL: options.callbackURL,
				errorCallbackURL: options.errorCallbackURL,
				disableRedirect: true
			},
			headers: event.request.headers
		})) as { url?: string; redirect: boolean };
	} catch (error) {
		log.warning(`Sign-in with Discord failed: ${error}`);
		return null;
	}
}

export async function signOut(event: RequestEvent) {
	if (!auth) return false;
	try {
		await auth.api.signOut({ headers: event.request.headers });
		return true;
	} catch (error) {
		log.warning(`Sign-out failed: ${error}`);
		return false;
	}
}

export async function getAuthSession(event: RequestEvent): Promise<BetterAuthSession | null> {
	if (!auth) return null;
	try {
		return await auth.api.getSession({ headers: event.request.headers });
	} catch (error) {
		log.warning(`Failed to read auth session: ${error}`);
		return null;
	}
}

export async function revokeDiscordToken(accessToken: string): Promise<boolean> {
	if (!discordClientId || !discordClientSecret) return false;
	try {
		const body = new URLSearchParams({
			token: accessToken,
			token_type_hint: "access_token",
			client_id: discordClientId,
			client_secret: discordClientSecret
		});
		const response = await fetch("https://discord.com/api/oauth2/token/revoke", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body
		});
		return response.ok;
	} catch (error) {
		log.warning(`Failed to revoke Discord token: ${error}`);
		return false;
	}
}

export async function getDiscordAccessToken(event: RequestEvent): Promise<string | null> {
	if (!auth) return null;
	try {
		const result = await auth.api.getAccessToken({
			headers: event.request.headers,
			body: {
				providerId: "discord"
			}
		});
		return result.accessToken || null;
	} catch (error) {
		log.warning(`Failed to fetch Discord access token from Better Auth: ${error}`);
		return null;
	}
}

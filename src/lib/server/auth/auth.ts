import { eq } from "drizzle-orm";
import { encodeBase32LowerCase } from "@oslojs/encoding";
import { db } from "@/lib/server/db/internal";
import * as table from "@/lib/server/db/internal/schema";

import type { User } from "@/lib/server/db/internal/schema";
import type { Perms } from "@/lib/utils/features";

function coercePerms(raw: unknown): Perms {
	const p = (raw ?? {}) as Partial<Perms>;
	return {
		everywhere: Array.isArray(p.everywhere) ? p.everywhere : [],
		areas: Array.isArray(p.areas) ? p.areas : []
	};
}

// Used by Better Auth's `advanced.database.generateId` for all auth-table rows
// (user, session, account, verification) — not user IDs specifically.
export function generateAuthRecordId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export async function getUserFromDiscordId(discordId: string) {
	const [row] = await db.select().from(table.user).where(eq(table.user.discordId, discordId));
	if (!row) return null;
	return { ...row, permissions: coercePerms(row.permissions) } as User;
}

export async function setPermissions(userId: string, permissions: Perms) {
	await db.update(table.user).set({ permissions }).where(eq(table.user.id, userId));
}

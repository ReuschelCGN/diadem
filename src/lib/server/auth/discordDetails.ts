type DiscordUserData = {
	id: string;
	username: string;
	global_name: string;
	avatar: string;
};

type DiscordGuildMember = {
	roles?: string[];
	user?: { id: string };
};

/** Three explicit outcomes from a Discord guild-member lookup. */
export type GuildMembership =
	| { ok: true; member: true; roles: string[] }
	| { ok: true; member: false }
	| { ok: false; status: number };

export type DiscordUser = {
	id: string;
	username: string;
	displayName: string;
	avatarUrl: string;
};

export type DiscordUserInfoResult = {
	status: number;
	data?: DiscordUser;
};

const endpoint = "https://discord.com/api/users/@me";

function getFetchOptions(accessToken: string): RequestInit {
	return {
		headers: {
			Authorization: `Bearer ${accessToken}`
		}
	};
}

export async function getUserInfoResult(accessToken: string): Promise<DiscordUserInfoResult> {
	const response = await fetch(endpoint, getFetchOptions(accessToken));

	if (!response.ok) {
		return { status: response.status };
	}

	const user: DiscordUserData = await response.json();
	return {
		status: response.status,
		data: {
			id: user.id,
			username: "@" + user.username,
			displayName: user.global_name || user.username || "",
			avatarUrl: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}`
		}
	};
}

export async function getGuildMemberInfo(
	guildId: string,
	accessToken: string
): Promise<GuildMembership> {
	const response = await fetch(
		`${endpoint}/guilds/${guildId}/member`,
		getFetchOptions(accessToken)
	);
	if (response.status === 404) return { ok: true, member: false };
	if (!response.ok) return { ok: false, status: response.status };

	const data = (await response.json()) as DiscordGuildMember;
	// Discord returns 200 with a member payload only when the user is in the guild.
	// `data.user` should always be present here, but guard so the type narrows cleanly.
	if (!data.user) return { ok: true, member: false };
	return { ok: true, member: true, roles: data.roles ?? [] };
}

// `undefined` means "we couldn't determine membership"; callers that need a
// definitive answer should branch on it (see ProfileCard's `=== false` check).
export async function isGuildMember(
	guildId: string,
	accessToken: string
): Promise<boolean | undefined> {
	const m = await getGuildMemberInfo(guildId, accessToken);
	if (!m.ok) return undefined;
	return m.member;
}

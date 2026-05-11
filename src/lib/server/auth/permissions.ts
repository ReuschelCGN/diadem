import { type KojiFeatures } from "@/lib/features/koji";
import { fetchKojiGeofences } from "@/lib/server/api/kojiApi";
import { setPermissions } from "@/lib/server/auth/userRecord";
import { type GuildMembership, getGuildMemberInfo } from "@/lib/server/auth/discordDetails";
import { type User } from "@/lib/server/db/internal/schema";
import { getServerConfig } from "@/lib/services/config/config.server";
import type { Permissions as ConfigRule } from "@/lib/services/config/configTypes";
import type { FeaturesKey, PermArea, Perms } from "@/lib/utils/features";
import { getLogger } from "@/lib/utils/logger";

const log = getLogger("permissions");

export type PermissionUser = {
	id: string;
	permissions: unknown;
};

// The everyone-only rule set is process-lifetime memoized; a config change
// requires a restart. Holds the resolved Perms object so callers can structuredClone.
let initializedEveryonePerms: boolean = false;
let everyonePerms: Perms = { everywhere: [], areas: [] };

function addFeatures(featureArray: FeaturesKey[], features: FeaturesKey[] | undefined) {
	if (!features) return;
	for (const feature of features) {
		if (!featureArray.includes(feature)) featureArray.push(feature);
	}
}

function applyAreaFeatures(
	ruleAreas: string[],
	ruleFeatures: FeaturesKey[] | undefined,
	perms: Perms,
	geofences: KojiFeatures
) {
	for (const ruleArea of ruleAreas) {
		let area = perms.areas.find((a) => a.name === ruleArea);
		if (!area) {
			const kojiFeature = geofences.find(
				(f) => f.properties.name.toLowerCase() === ruleArea.toLowerCase()
			);
			if (!kojiFeature) {
				log.error(
					`Configured area "${ruleArea}" has no matching Koji area; ignoring its permissions.`
				);
				continue;
			}
			area = { name: ruleArea, features: [], polygon: kojiFeature.geometry } satisfies PermArea;
			perms.areas.push(area);
		}
		addFeatures(area.features, ruleFeatures);
	}
}

function handleRule(rule: ConfigRule, perms: Perms, geofences: KojiFeatures | undefined) {
	if (rule.areas) {
		if (!geofences) return;
		applyAreaFeatures(rule.areas, rule.features, perms, geofences);
	} else {
		addFeatures(perms.everywhere, rule.features);
	}
}

async function getGeofences(thisFetch: typeof fetch) {
	const data = await fetchKojiGeofences(thisFetch);
	if (!data) {
		log.error("Koji error while handling permissions. All area-based permissions are ignored");
	}
	return data;
}

export async function getEveryonePerms(thisFetch: typeof fetch, geofences?: KojiFeatures) {
	if (initializedEveryonePerms) return everyonePerms;

	if (!geofences) geofences = await getGeofences(thisFetch);

	const perms: Perms = { everywhere: [], areas: [] };
	for (const rule of getServerConfig().permissions ?? []) {
		if (rule.everyone) {
			handleRule(rule, perms, geofences);
		}
	}
	initializedEveryonePerms = true;
	everyonePerms = perms;
	return everyonePerms;
}

export async function updatePermissions(
	user: PermissionUser,
	accessToken: string,
	thisFetch: typeof fetch
) {
	const guildCache: { [key: string]: GuildMembership } = {};
	const authConfig = getServerConfig().auth;
	const permConfig = getServerConfig().permissions;
	const canCheckGuildRules = accessToken.trim().length > 0;

	const geofences = await getGeofences(thisFetch);

	const permissions: Perms = structuredClone(await getEveryonePerms(thisFetch, geofences));

	if (permConfig && authConfig.enabled) {
		for (const rule of permConfig) {
			let ruleApplies = !!rule.loggedIn || !!rule.everyone;

			if (!ruleApplies && rule.guildId) {
				if (!canCheckGuildRules) {
					continue;
				}

				let membership = guildCache[rule.guildId];
				if (!membership) {
					membership = await getGuildMemberInfo(rule.guildId, accessToken);
					if (!membership.ok) {
						log.warning(
							`discord guild lookup failed for user ${user.id} (status ${membership.status}); treating guild ${rule.guildId} as non-member`
						);
					}
					guildCache[rule.guildId] = membership;
				}

				// An empty roleId means "membership alone qualifies"; otherwise
				// the user must hold the specific role.
				if (membership.ok && membership.member) {
					if (!rule.roleId) ruleApplies = true;
					else if (membership.roles.includes(rule.roleId)) ruleApplies = true;
				}
			}

			if (ruleApplies) {
				handleRule(rule, permissions, geofences);
			}
		}
	}

	await setPermissions(user.id, permissions);
	return permissions;
}

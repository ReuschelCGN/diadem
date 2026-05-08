import { getLogger } from "@/lib/utils/logger";
import { masterfileProvider } from "@/lib/server/provider/masterfileProvider";
import { uiconsIndexProvider } from "@/lib/server/provider/uiconsIndexProvider";
import { remoteLocaleProvider } from "@/lib/server/provider/remoteLocaleProvider";
import { masterstatsProvider } from "@/lib/server/provider/masterStatsProvider";

export async function initDiadem() {
	const log = getLogger("init");
	log.info("Initializing Diadem");

	await Promise.all([
		masterfileProvider.refresh(),
		uiconsIndexProvider.refresh(),
		remoteLocaleProvider.refresh(),
		masterstatsProvider.refresh()
	]);
	log.info("Finished initializing");
}

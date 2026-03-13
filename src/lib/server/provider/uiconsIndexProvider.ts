import { getClientConfig } from "@/lib/services/config/config.server";
import { getLogger } from "@/lib/utils/logger";
import { BaseDataProvider } from "@/lib/server/provider/dataProvider";
import { REFRESH_UICON_INDEX } from "@/lib/constants";
import type { UiconSet } from "@/lib/services/config/configTypes";
import { sleep } from "@/lib/utils/time";

type UiconIndex = Map<string, string>

const log = getLogger("q:uiconindex");

export class UiconsIndexProvider extends BaseDataProvider<UiconIndex> {
	constructor() {
		super(REFRESH_UICON_INDEX);
	}

	private async refreshSingleIndex(uiconSet: UiconSet): Promise<[string, string]> {
		log.info("[%s] Updating index", uiconSet.name)

		let data: string | undefined
		while (!data) {
			const result = await fetch(uiconSet.url + "/index.json")
			if (!result.ok) {
				log.crit("[%s] Couldn't fetch index.json from %s (%s)", uiconSet.name, result.url, await result.text())
				await sleep(1000 * 60)
				continue
			}

			data = await result.text()
		}

		log.info("[%s] Updated Index", uiconSet.name)
		return [uiconSet.id, data]
	}

	public async refresh(): Promise<UiconIndex> {
		const results = await Promise.all(
			getClientConfig().uiconSets.map((uiconset) => {
				return this.refreshSingleIndex(uiconset);
			})
		);
		return new Map(results)
	}

	public async getIndex(uiconsetId: string) {
		if (!getClientConfig().uiconSets.find(u => u.id === uiconsetId)) {
			return
		}

		const allIndexes = await this.get()
		return allIndexes.get(uiconsetId)
	}
}

export const uiconsIndexProvider = new UiconsIndexProvider();

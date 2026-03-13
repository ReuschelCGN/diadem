import type { MasterFile } from "@/lib/types/masterfile";
import { getLogger } from "@/lib/utils/logger";
import { BaseDataProvider } from "@/lib/server/provider/dataProvider";
import { REFRESH_MASTERFILE } from "@/lib/constants";
import { sleep } from "@/lib/utils/time";

const log = getLogger("q:masterfile");
const url = "https://raw.githubusercontent.com/WatWowMap/Masterfile-Generator/refs/heads/master/master-latest-react-map.json";

export class MasterfileProvider extends BaseDataProvider<MasterFile> {
	constructor() {
		super(REFRESH_MASTERFILE);
	}

	public async refresh(): Promise<MasterFile> {
		log.info("Updating masterfile");

		let data: MasterFile | undefined = undefined;
		while (!data) {
			const response = await fetch(url);

			if (!response.ok) {
				log.crit(
					"Couldn't fetch masterfile from %s | %d (%s)",
					url,
					response.status,
					await response.text()
				);
				await sleep(1000 * 60);
				continue;
			}

			data = (await response.json()) as MasterFile;
		}

		log.info("Updated masterfile");

		return {
			pokemon: data.pokemon,
			items: data.items,
			weather: data.weather
		};
	}
}

export const masterfileProvider = new MasterfileProvider();

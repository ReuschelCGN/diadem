import { prefixes as localePrefixesObject } from "@/lib/services/ingameLocale";
import { locales } from "@/lib/paraglide/runtime";
import { getLogger } from "@/lib/utils/logger";
import { BaseDataProvider } from "@/lib/server/provider/dataProvider";
import { REFRESH_REMOTE_LOCALE } from "@/lib/constants";
import { sleep } from "@/lib/utils/time";

type Locales = (typeof locales)[number];
type RemoteLocale = { [key: string]: string };
type RemoteLocaleStorage = { [key in Locales]: RemoteLocale };

const log = getLogger("q:remotelocale");

const url = "https://raw.githubusercontent.com/WatWowMap/pogo-translations/refs/heads/master/static/locales/{}.json";
const allowedPrefixes = Object.values(localePrefixesObject);

export class RemoteLocaleProvider extends BaseDataProvider<RemoteLocaleStorage> {
	constructor() {
		super(REFRESH_REMOTE_LOCALE);
	}

	private async refreshSingleRemoteLocale(locale: Locales): Promise<[Locales, RemoteLocale]> {
		let targetLocale: string = locale;
		if (locale === "pt") {
			targetLocale = "pt-br";
		}

		log.info("[%s] Updating remote locale", locale);

		let data: RemoteLocale | undefined = undefined;
		while (!data) {
			const result = await fetch(url.replaceAll("{}", targetLocale));
			if (!result.ok) {
				log.crit("[%s] Fetching remote locale failed: %s", locale, await result.text());
				await sleep(1000 * 60);
				continue
			}

			data = await result.json()
		}

		const remoteLocale: RemoteLocale = {};

		for (const [key, value] of Object.entries(data)) {
			for (const allowedPrefix of allowedPrefixes) {
				if (key.startsWith(allowedPrefix)) {
					remoteLocale[key] = value;
					break;
				}
			}
		}

		log.info("[%s] Updated remote locale", locale);
		return [locale, remoteLocale]
	}

	public async refresh(): Promise<RemoteLocaleStorage> {
		const results = await Promise.all(
			locales.map((tag) => {
				return this.refreshSingleRemoteLocale(tag);
			})
		);
		// @ts-ignore
		return Object.fromEntries(results)
	}

	public async getRemoteLocale(tag: string) {
		if (!locales.includes(tag as Locales)) return {};

		const remoteLocales = await this.get()

		return remoteLocales[tag as Locales] ?? {};
	}
}

export const remoteLocaleProvider = new RemoteLocaleProvider()

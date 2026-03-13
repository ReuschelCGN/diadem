import { error, json } from "@sveltejs/kit";
import { remoteLocaleProvider } from "@/lib/server/provider/remoteLocaleProvider";
import { locales } from "@/lib/paraglide/runtime";

export async function GET({ params }) {
	if (!locales.includes(params.tag)) {
		error(404);
	}

	return json(await remoteLocaleProvider.getRemoteLocale(params.tag));
}

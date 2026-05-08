import { masterfileProvider } from "@/lib/server/provider/masterfileProvider";
import { json } from "@sveltejs/kit";
import { cacheHttpHeaders } from "@/lib/utils/apiUtils.server";

export async function GET() {
	const masterfile = await masterfileProvider.get();

	return json(masterfile, {
		headers: {
			...cacheHttpHeaders(3600)
		}
	});
}

<script lang="ts">
	import Metadata from "@/components/utils/Metadata.svelte";
	import { browser } from "$app/environment";
	import type { PageProps } from "./$types";
	import RedirectFlash from "@/components/ui/RedirectFlash.svelte";
	import { getConfig } from "@/lib/services/config/config";
	import { m } from "@/lib/paraglide/messages";

	let { data }: PageProps = $props();
</script>

{#if !browser && data && data.title}
	<Metadata
		title={data.title}
		image={getConfig().general.url + `/${data.type}/${data.id}/thumbnail.png`}
	/>
{/if}

<RedirectFlash goal={data.title ?? m["pogo_" + data.type]()} />

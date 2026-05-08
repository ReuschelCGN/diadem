<script lang="ts">
	import { isPopupExpanded, togglePopupExpanded } from "@/lib/ui/expandedPopups.js";
	import { Copy, Eye, EyeClosed, Navigation, Share2 } from "lucide-svelte";
	import Button from "@/components/ui/input/Button.svelte";
	import * as m from "@/lib/paraglide/messages";

	import { getCurrentPath } from "@/lib/mapObjects/interact";
	import {
		backupShareUrl,
		canNativeShare,
		copyToClipboard,
		hasClipboardWrite
	} from "@/lib/utils/device";
	import { getMapsUrl } from "@/lib/utils/mapUrl";
	import { Coords } from "@/lib/utils/coordinates";
	import { getShareTitle } from "@/lib/features/shareTexts";
	import { getCurrentSelectedData } from "@/lib/mapObjects/currentSelectedState.svelte";
	import { getLocale } from "@/lib/paraglide/runtime";

	let {
		lat,
		lon
	}: {
		lat: number;
		lon: number;
	} = $props();

	function getShareUrl() {
		return window.location.origin + getCurrentPath() + "?lang=" + getLocale();
	}
</script>

<div class="flex px-4 gap-1.5 absolute bottom-4 w-full">
	<Button size="default" onclick={() => togglePopupExpanded(getCurrentSelectedData()?.type)}>
		{#if isPopupExpanded(getCurrentSelectedData()?.type)}
			<EyeClosed size="18" />
			<span class="@max-[304px]:hidden">
				{m.popup_hide_details()}
			</span>
		{:else}
			<Eye size="18" />
			<span class="@max-[304px]:hidden">
				{m.popup_show_details()}
			</span>
		{/if}
	</Button>
	<Button
		size="default"
		variant="outline"
		tag="a"
		href={getMapsUrl(new Coords(lat, lon), getShareTitle(getCurrentSelectedData()))}
		target="_blank"
	>
		<Navigation size="18" />
		<span class="@max-[364px]:hidden">
			{m.popup_navigate()}
		</span>
	</Button>

	{#if canNativeShare({ url: getShareUrl() })}
		<Button variant="outline" tag="button" onclick={() => backupShareUrl(getShareUrl())}>
			<Share2 size="18" />
			<span class="@max-[406px]:hidden">
				{m.popup_share()}
			</span>
		</Button>
	{:else if hasClipboardWrite()}
		<Button variant="outline" tag="button" onclick={() => copyToClipboard(getShareUrl())}>
			<Copy size="18" />
			<span class="@max-[406px]:hidden">
				{m.copy_link()}
			</span>
		</Button>
	{/if}
</div>

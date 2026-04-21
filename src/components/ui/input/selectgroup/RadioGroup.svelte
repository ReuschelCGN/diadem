<script lang="ts">
	import { RadioGroup } from "bits-ui";
	import type { Snippet } from "svelte";

	let {
		class: class_ = "",
		value = "",
		children = undefined,
		...rest
	}: {
		class?: string;
		value?: string;
		children?: Snippet;
	} & RadioGroup.RootProps = $props();
</script>

<RadioGroup.Root
	bind:value
	orientation="horizontal"
	class="flex flex-wrap gap-4 {class_}"
	{...rest}
>
	{@render children?.()}
</RadioGroup.Root>

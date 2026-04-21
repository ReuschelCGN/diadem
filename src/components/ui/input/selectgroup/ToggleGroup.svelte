<script lang="ts">
	import { ToggleGroup } from "bits-ui";
	import type { Snippet } from "svelte";

	let {
		class: class_ = "",
		children = undefined,
		onchange = () => {},
		values = $bindable(),
		orientation = "horizontal"
	}: {
		class?: string;
		children?: Snippet;
		onchange?: (values: string[]) => void;
		values: string[];
		orientation?: "horizontal" | "vertical";
	} = $props();
</script>

<ToggleGroup.Root
	bind:value={values}
	onValueChange={onchange}
	type="multiple"
	class="flex flex-wrap gap-4 {class_}"
	{orientation}
>
	{@render children?.()}
</ToggleGroup.Root>

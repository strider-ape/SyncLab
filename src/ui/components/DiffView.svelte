<script lang="ts">
	import { decodeText, diffRows, type CompareSide } from '../compare';

	interface Props {
		path: string;
		subtitle: string;
		/** Lines read as changes from this version… */
		before: CompareSide;
		/** …to this one. */
		after: CompareSide;
		onClose: () => void;
	}

	let { path, subtitle, before, after, onClose }: Props = $props();

	const beforeText = $derived(decodeText(before.data));
	const afterText = $derived(decodeText(after.data));
	const binary = $derived(beforeText === undefined || afterText === undefined);
	const lines = $derived(binary ? [] : diffRows(beforeText ?? '', afterText ?? ''));

	function size(data: ArrayBuffer | null): string {
		if (!data) return 'missing';
		const kb = data.byteLength / 1024;
		return kb < 1 ? `${data.byteLength} bytes` : `${kb.toFixed(1)} KB`;
	}
</script>

<div class="sl-wizard">
	<div class="sl-wizard-top">
		<h1 class="sl-wordmark" style:font-size="26px">Compare</h1>
	</div>
	<section class="sl-card">
		<div class="sl-card-head sl-head-blue">
			<div class="sl-titles"><h2>{path}</h2><p>{subtitle}</p></div>
		</div>
		<div class="sl-card-body">
			<div class="sl-diff-legend">
				<span class="sl-pill">− {before.label} · {size(before.data)}</span>
				<span class="sl-pill">+ {after.label} · {size(after.data)}</span>
			</div>
			{#if binary}
				<p>This is a binary file, so there's no line-by-line view. Sizes are shown above.</p>
			{:else if lines.every(line => line.kind === 'same' || line.kind === 'gap')}
				<p>No differences in the text.</p>
			{:else}
				<div class="sl-diff">
					{#each lines as line, index (index)}
						{#if line.kind === 'gap'}
							<div class="sl-diff-gap">{line.count} unchanged line{line.count === 1 ? '' : 's'}</div>
						{:else}
							<div class="sl-diff-line" class:is-add={line.kind === 'add'} class:is-del={line.kind === 'del'}>
								<span class="sl-sign">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span>
								<span>{line.text || ' '}</span>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	</section>
	<div class="sl-wizard-actions">
		<span></span>
		<button class="sl-btn" type="button" onclick={onClose}>Close</button>
	</div>
</div>

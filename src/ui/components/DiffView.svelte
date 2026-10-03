<script lang="ts">
	import { diffLines } from 'diff';

	interface Props {
		path: string;
		remote: ArrayBuffer | null;
		local: ArrayBuffer | null;
		onClose: () => void;
	}

	let { path, remote, local, onClose }: Props = $props();

	type Line = { kind: 'add' | 'del' | 'same'; text: string } | { kind: 'gap'; count: number };

	const CONTEXT = 3;

	function decode(data: ArrayBuffer | null): string | null | undefined {
		if (data === null) return null;
		try {
			return new TextDecoder('utf-8', { fatal: true }).decode(data);
		} catch {
			return undefined;
		}
	}

	const remoteText = $derived(decode(remote));
	const localText = $derived(decode(local));
	const binary = $derived(remoteText === undefined || localText === undefined);

	const lines = $derived.by((): Line[] => {
		if (binary) return [];
		const parts = diffLines(remoteText ?? '', localText ?? '');
		const all: Array<{ kind: 'add' | 'del' | 'same'; text: string }> = [];
		for (const part of parts) {
			const kind = part.added ? 'add' : part.removed ? 'del' : 'same';
			const text = part.value.endsWith('\n') ? part.value.slice(0, -1) : part.value;
			for (const line of text.split('\n')) all.push({ kind, text: line });
		}
		// Collapse long runs of unchanged lines, keeping a little context around changes.
		const out: Line[] = [];
		let i = 0;
		while (i < all.length) {
			if (all[i]?.kind !== 'same') {
				out.push(all[i]!);
				i++;
				continue;
			}
			let j = i;
			while (j < all.length && all[j]?.kind === 'same') j++;
			const run = all.slice(i, j);
			const keepHead = i === 0 ? 0 : CONTEXT;
			const keepTail = j === all.length ? 0 : CONTEXT;
			if (run.length > keepHead + keepTail + 1) {
				out.push(...run.slice(0, keepHead), { kind: 'gap', count: run.length - keepHead - keepTail }, ...run.slice(run.length - keepTail));
			} else {
				out.push(...run);
			}
			i = j;
		}
		return out;
	});

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
			<div class="sl-titles"><h2>{path}</h2><p>GitLab's version → this vault</p></div>
		</div>
		<div class="sl-card-body">
			<div class="sl-diff-legend">
				<span class="sl-pill">− GitLab · {size(remote)}</span>
				<span class="sl-pill">+ This vault · {size(local)}</span>
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

<script lang="ts">
	import type { Change } from '../../core/types';
	import { badgeFor, splitPath } from '../format';
	import { icon } from '../icon';

	interface Props {
		change: Change;
		included: boolean;
		onToggle: () => void;
		onOpen: () => void;
		onOpenFile: (event: MouseEvent) => void;
	}

	let { change, included, onToggle, onOpen, onOpenFile }: Props = $props();

	const badge = $derived(badgeFor(change));
	const parts = $derived(splitPath(change.path));
</script>

<div class="sl-row" class:is-off={!included}>
	<input
		class="sl-check"
		type="checkbox"
		checked={included}
		onchange={onToggle}
		aria-label={`Include ${change.path} in the next sync`}
	/>
	<span class="sl-badge {badge.className}" aria-hidden="true">{badge.letter}</span>
	<button class="sl-name" type="button" onclick={onOpen} title={`Compare ${change.path}`}>
		<b>{parts.name}</b>
		<small>{badge.status} · {parts.folder || 'Vault root'}</small>
	</button>
	<!-- Only files that exist in the vault right now can be opened. -->
	{#if change.local !== undefined}
		<button class="sl-open" type="button" aria-label={`Open ${parts.name}`} onclick={onOpenFile}><span use:icon={'file-text'}></span></button>
	{/if}
</div>

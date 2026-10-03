<script lang="ts">
	import type { Change } from '../../core/types';
	import { badgeFor, splitPath } from '../format';

	interface Props {
		change: Change;
		included: boolean;
		onToggle: () => void;
		onOpen: () => void;
	}

	let { change, included, onToggle, onOpen }: Props = $props();

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
		<small>{parts.folder || 'Vault root'}</small>
	</button>
	<span class="sl-tag">{badge.tag}</span>
</div>

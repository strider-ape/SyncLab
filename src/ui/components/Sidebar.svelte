<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import type { Change, Resolution } from '../../core/types';
	import type { SidebarHost } from '../host';
	import { icon } from '../icon';
	import { conflictReason, relativeTime, splitPath } from '../format';
	import ChangeRow from './ChangeRow.svelte';

	let { host }: { host: SidebarHost } = $props();

	// The host never changes for the lifetime of the view.
	const engineState = untrack(() => host.engine.state);
	const info = untrack(() => host.info);

	let message = $state('');
	let justSynced = $state(false);
	let now = $state(Date.now());
	const excluded = new SvelteSet<string>();
	const resolutions = new SvelteMap<string, Resolution>();

	$effect(() => {
		const timer = window.setInterval(() => (now = Date.now()), 30_000);
		return () => window.clearInterval(timer);
	});

	const changes = $derived($engineState.changes);
	const conflicts = $derived(changes.filter(c => c.decision.kind === 'conflict'));
	const outgoing = $derived(changes.filter(c => c.decision.kind === 'push'));
	const incoming = $derived(changes.filter(c => c.decision.kind === 'pull'));

	// Forget choices for paths that no longer have a pending change.
	$effect(() => {
		const live = new Set(changes.map(c => c.path));
		for (const path of [...excluded]) if (!live.has(path)) excluded.delete(path);
		for (const path of [...resolutions.keys()]) if (!live.has(path)) resolutions.delete(path);
	});

	const upCount = $derived(
		outgoing.filter(c => !excluded.has(c.path)).length +
			conflicts.filter(c => resolutions.get(c.path) === 'mine' || resolutions.get(c.path) === 'both').length,
	);
	const downCount = $derived(
		incoming.filter(c => !excluded.has(c.path)).length +
			conflicts.filter(c => resolutions.get(c.path) === 'theirs' || resolutions.get(c.path) === 'both').length,
	);
	const ready = $derived(upCount + downCount);
	const syncing = $derived($engineState.phase === 'syncing');
	const checking = $derived($engineState.phase === 'checking');
	const progress = $derived($engineState.progress);
	const allOutgoingIncluded = $derived(outgoing.every(c => !excluded.has(c.path)));

	const syncLabel = $derived.by(() => {
		if (syncing) return progress && progress.total > 0 ? `Syncing ${progress.done}/${progress.total}` : 'Checking…';
		if (justSynced) return 'Synced';
		if (ready === 0) return conflicts.length ? 'Nothing selected' : 'Up to date';
		return 'Sync';
	});

	const status = $derived.by(() => {
		if (syncing) return { label: 'Syncing', className: 'is-busy' };
		if ($engineState.error) return { label: 'Offline', className: 'is-bad' };
		if ($engineState.checkedAt) return { label: 'Connected', className: 'is-ok' };
		return { label: 'Checking', className: 'is-busy' };
	});

	function toggle(change: Change) {
		if (excluded.has(change.path)) excluded.delete(change.path);
		else excluded.add(change.path);
	}

	function toggleAllOutgoing() {
		const include = !allOutgoingIncluded;
		for (const change of outgoing) {
			if (include) excluded.delete(change.path);
			else excluded.add(change.path);
		}
	}

	function choose(path: string, resolution: Resolution) {
		if (resolutions.get(path) === resolution) resolutions.delete(path);
		else resolutions.set(path, resolution);
	}

	async function sync() {
		if (syncing) return;
		const summary = await host.sync({ message, excluded: new Set(excluded), resolutions: new Map(resolutions) });
		if (!summary.error && !summary.cancelled) {
			message = '';
			justSynced = true;
			window.setTimeout(() => (justSynced = false), 1600);
		}
	}

	let logEl: HTMLDivElement | undefined = $state();
	// Keep the newest activity in view.
	$effect(() => {
		void $engineState.log.length;
		if (logEl) logEl.scrollTop = logEl.scrollHeight;
	});

	function time(at: number): string {
		return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}
</script>

<div class="synclab-sidebar">
	<div class="sl-brand">
		{#if $info.configured}
			<div class="sl-topbar">
				<button class="sl-path" type="button" onclick={() => host.openOnGitLab()} title="Open on GitLab">{$info.projectPath}</button>
				<span class="sl-spacer"></span>
				<button class="sl-icon-btn" type="button" aria-label="Check for changes" title="Check for changes" disabled={syncing} onclick={() => host.refresh()}>
					<span use:icon={'refresh-cw'}></span>
				</button>
				<button class="sl-icon-btn" type="button" aria-label="SyncLab options" title="Options" onclick={() => host.openSettings()}>
					<span use:icon={'settings'}></span>
				</button>
			</div>
		{/if}
		<h1 class="sl-wordmark">Sync<span class="sl-lab">Lab</span></h1>
		<p class="sl-tagline">Review it. Hit sync. Done.</p>
		{#if $info.configured}
			<div class="sl-pills">
				<span class="sl-pill {status.className}"><span class="sl-dot"></span>{status.label}</span>
				<span class="sl-pill is-mono"><span use:icon={'git-branch'}></span>{$info.branch}</span>
			</div>
		{/if}
	</div>

	{#if !$info.configured}
		<section class="sl-card">
			<div class="sl-card-head sl-head-yellow">
				<div class="sl-titles">
					<h2>{$info.missingToken ? 'Reconnect GitLab' : 'Connect GitLab'}</h2>
					<p>{$info.missingToken ? 'Your token isn’t on this device yet' : 'Two minutes, once per device'}</p>
				</div>
			</div>
			<div class="sl-card-body">
				<ol class="sl-steps">
					<li>Tell SyncLab where your GitLab is</li>
					<li>Paste a token (we'll open the right page)</li>
					<li>Pick a project and a branch</li>
				</ol>
				<button class="sl-btn is-primary is-block" type="button" onclick={() => host.openSetup()}>
					{$info.missingToken ? 'Add token' : 'Connect GitLab'}
				</button>
			</div>
		</section>
	{:else}
		{#if $engineState.error}
			<div class="sl-notice is-error" role="alert">
				<div class="sl-notice-body"><b>Couldn't reach GitLab.</b> {$engineState.error}</div>
				<button class="sl-mini" type="button" onclick={() => host.refresh()}>Retry</button>
			</div>
		{/if}

		{#if $engineState.firstSync && changes.length > 0}
			<div class="sl-notice is-info">
				<div class="sl-notice-body"><b>First sync here.</b> Nothing gets deleted, and files that differ show up as conflicts for you to decide.</div>
			</div>
		{/if}

		<section class="sl-card">
			<div class="sl-card-head sl-head-yellow">
				<div class="sl-titles">
					<h2>Commit &amp; sync</h2>
					<p>Pull GitLab changes, push yours</p>
				</div>
				<span class="sl-pill"><span class="sl-dot"></span>{ready} ready</span>
			</div>
			<div class="sl-card-body">
				<label class="sl-label" for="synclab-message">Message <span class="sl-soft">(optional)</span></label>
				<textarea id="synclab-message" class="sl-field" bind:value={message} placeholder="What changed?" disabled={syncing}></textarea>
				<p class="sl-hint">Leave it empty and SyncLab writes one for you.</p>
				<button
					class="sl-sync"
					class:is-busy={syncing}
					class:is-done={justSynced && !syncing}
					class:is-quiet={!syncing && !justSynced && ready === 0}
					type="button"
					aria-busy={syncing}
					onclick={sync}
				>
					{#if syncing && progress && progress.total > 0}
						<span class="sl-progress" style:width={`${Math.round((progress.done / progress.total) * 100)}%`}></span>
					{/if}
					<span class="sl-sync-icon" use:icon={justSynced && !syncing ? 'check' : 'refresh-cw'}></span>
					<span class="sl-sync-label">{syncLabel}</span>
					{#if !syncing && !justSynced && ready > 0}
						<span class="sl-counts"><span>↑ {upCount}</span><span>↓ {downCount}</span></span>
					{/if}
				</button>
			</div>
		</section>

		{#if conflicts.length > 0}
			<section class="sl-card">
				<div class="sl-card-head sl-head-pink">
					<div class="sl-titles">
						<h2>{conflicts.length} conflict{conflicts.length === 1 ? '' : 's'}</h2>
						<p>Pick which version to keep</p>
					</div>
					<span class="sl-pill"><span class="sl-dot"></span>Needs you</span>
				</div>
				<div class="sl-card-body">
					{#each conflicts as change (change.path)}
						{@const parts = splitPath(change.path)}
						<div class="sl-conflict">
							<div class="sl-conflict-file">
								<span class="sl-badge sl-b-conflict" aria-hidden="true">!</span>
								<button class="sl-name" type="button" onclick={() => host.openDiff(change)} title={`Compare ${change.path}`}>
									<b>{parts.name}</b>
									<small>{change.decision.kind === 'conflict' ? conflictReason(change.decision.reason) : ''}</small>
								</button>
							</div>
							<div class="sl-choices" role="group" aria-label={`Resolve ${change.path}`}>
								<button class="sl-choice" type="button" aria-pressed={resolutions.get(change.path) === 'mine'} title="Keep the version in this vault" onclick={() => choose(change.path, 'mine')}>Mine</button>
								<button class="sl-choice" type="button" aria-pressed={resolutions.get(change.path) === 'theirs'} title="Keep GitLab's version; yours goes to the trash" onclick={() => choose(change.path, 'theirs')}>Theirs</button>
								<button class="sl-choice" type="button" aria-pressed={resolutions.get(change.path) === 'both'} title="Keep yours and save GitLab's next to it" onclick={() => choose(change.path, 'both')}>Both</button>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		{#if outgoing.length > 0}
			<section class="sl-card">
				<div class="sl-card-head sl-head-blue">
					<div class="sl-titles">
						<h2>Your changes</h2>
						<p>Edited in this vault</p>
					</div>
					<button class="sl-mini" type="button" onclick={toggleAllOutgoing}>{allOutgoingIncluded ? 'None' : 'All'}</button>
				</div>
				<div class="sl-card-body sl-list">
					{#each outgoing as change (change.path)}
						<ChangeRow {change} included={!excluded.has(change.path)} onToggle={() => toggle(change)} onOpen={() => host.openDiff(change)} />
					{/each}
				</div>
			</section>
		{/if}

		{#if incoming.length > 0}
			<section class="sl-card">
				<div class="sl-card-head sl-head-violet">
					<div class="sl-titles">
						<h2>From GitLab</h2>
						<p>Changed somewhere else</p>
					</div>
				</div>
				<div class="sl-card-body sl-list">
					{#each incoming as change (change.path)}
						<ChangeRow {change} included={!excluded.has(change.path)} onToggle={() => toggle(change)} onOpen={() => host.openDiff(change)} />
					{/each}
				</div>
			</section>
		{/if}

		{#if changes.length === 0 && !$engineState.error && $engineState.checkedAt && !checking}
			<div class="sl-notice">
				<div class="sl-notice-body"><b>All in sync.</b> Edit a note and it shows up here.</div>
			</div>
		{/if}

		{#if $engineState.attention.length > 0 || $engineState.tooLarge.length > 0}
			<section class="sl-card">
				<div class="sl-card-head sl-head-orange">
					<div class="sl-titles">
						<h2>Left alone</h2>
						<p>SyncLab won't touch these</p>
					</div>
				</div>
				<div class="sl-card-body sl-list">
					{#each $engineState.attention as item (item.path)}
						<p class="sl-hint"><b>{item.path}</b>: another file has the same name with different capitals. Rename one of them.</p>
					{/each}
					{#each $engineState.tooLarge as path (path)}
						<p class="sl-hint"><b>{path}</b>: larger than the size limit in options.</p>
					{/each}
				</div>
			</section>
		{/if}

		<section>
			<div class="sl-log-head">
				<span class="sl-label">Activity</span>
				<button class="sl-mini" type="button" onclick={() => host.engine.clearLog()}>Clear</button>
			</div>
			<div class="sl-log" aria-live="polite" bind:this={logEl}>
				{#if $engineState.log.length === 0}
					<div class="sl-empty">Nothing synced yet. Press Sync.</div>
				{:else}
					{#each $engineState.log as entry (entry.id)}
						<div><span class="sl-time">{time(entry.at)}</span><span class="k-{entry.kind}">{entry.text}</span></div>
					{/each}
				{/if}
			</div>
		</section>

		<div class="sl-foot">
			<span>{relativeTime($engineState.lastSyncAt, now)}</span>
			<span>{$info.deviceName}</span>
		</div>
	{/if}
</div>

<script lang="ts">
	import { DEVELOPER_ACCESS, normalizeBaseUrl, type GitLabBranch, type GitLabClient, type GitLabProject, type GitLabUser } from '../../gitlab/GitLabClient';
	import { untrack } from 'svelte';
	import { icon } from '../icon';
	import { accessLevel, explain, tokenPageUrl, validateGitLabUrl, type WizardHost } from '../wizard';

	let { host }: { host: WizardHost } = $props();

	// Starting values only; the wizard owns its state from here on.
	const initial = untrack(() => ({
		url: host.initialUrl,
		folder: host.initialFolder,
		deviceName: host.initialDeviceName,
		token: host.existingToken,
		firstFolder: host.folders[0] ?? '',
	}));
	const startsSelfHosted = normalizeBaseUrl(initial.url) !== 'https://gitlab.com';

	const STEPS = ['Where', 'Connect', 'Project', 'Branch', 'Scope'];
	const GITLAB_COM = 'https://gitlab.com';

	let step = $state(0);
	let busy = $state(false);
	let error = $state('');

	// Step 1
	let selfHosted = $state(startsSelfHosted);
	let customUrl = $state(startsSelfHosted ? initial.url : '');
	const baseUrl = $derived(normalizeBaseUrl(selfHosted ? customUrl : GITLAB_COM));

	// Step 2
	let token = $state(initial.token ?? '');
	let user = $state<GitLabUser | null>(null);
	let client: GitLabClient | null = null;

	// Step 3
	let query = $state('');
	let projects = $state<GitLabProject[]>([]);
	let project = $state<GitLabProject | null>(null);
	let newProjectName = $state('Obsidian vault');
	let searchTimer = 0;

	// Step 4
	let branches = $state<GitLabBranch[]>([]);
	let branch = $state('');

	// Step 5
	let wholeVault = $state(initial.folder === '');
	let folder = $state(initial.folder || initial.firstFolder);
	let deviceName = $state(initial.deviceName);

	function go(next: number) {
		error = '';
		step = next;
	}

	async function run(task: () => Promise<void>) {
		busy = true;
		error = '';
		try {
			await task();
		} finally {
			busy = false;
		}
	}

	function nextFromWhere() {
		if (selfHosted) {
			const problem = validateGitLabUrl(customUrl);
			if (problem) {
				error = problem;
				return;
			}
		}
		user = null;
		go(1);
	}

	function connect() {
		if (!token.trim()) {
			error = 'Paste your token first.';
			return;
		}
		return run(async () => {
			try {
				client = host.client(baseUrl, token.trim());
				user = await client.currentUser();
				await search('');
				go(2);
			} catch (e) {
				user = null;
				error = explain(e, 'token');
			}
		});
	}

	async function search(text: string) {
		if (!client) return;
		try {
			projects = await client.searchProjects(text);
		} catch (e) {
			error = explain(e);
		}
	}

	function onQuery(event: Event) {
		query = (event.currentTarget as HTMLInputElement).value;
		window.clearTimeout(searchTimer);
		searchTimer = window.setTimeout(() => void search(query), 300);
	}

	function createProject() {
		if (!newProjectName.trim()) {
			error = 'Give the new project a name.';
			return;
		}
		return run(async () => {
			try {
				project = await client!.createProject(newProjectName.trim());
				projects = [project, ...projects];
			} catch (e) {
				error = explain(e);
			}
		});
	}

	function nextFromProject() {
		if (!project) {
			error = 'Pick a project, or create a new one.';
			return;
		}
		const picked = project;
		return run(async () => {
			try {
				const full = await client!.getProject(picked.id);
				if (accessLevel(full) < DEVELOPER_ACCESS) {
					error = `You need Developer access or higher on ${full.path_with_namespace} to push to it.`;
					return;
				}
				project = full;
				branches = await client!.listBranches(full.id);
				branch = branches.find(b => b.default)?.name ?? full.default_branch ?? branches[0]?.name ?? 'main';
				go(3);
			} catch (e) {
				error = explain(e, 'project');
			}
		});
	}

	function nextFromBranch() {
		if (!branch.trim()) {
			error = 'Pick a branch.';
			return;
		}
		go(4);
	}

	function finish() {
		if (!wholeVault && !folder) {
			error = 'Pick a folder, or sync the whole vault.';
			return;
		}
		return run(async () => {
			try {
				await host.finish({
					gitlabUrl: baseUrl,
					token: token.trim(),
					project: project!,
					branch: branch.trim(),
					folder: wholeVault ? '' : folder,
					deviceName: deviceName.trim(),
				});
				host.close();
			} catch (e) {
				error = explain(e);
			}
		});
	}

	const selectedBranch = $derived(branches.find(b => b.name === branch));
</script>

<div class="sl-wizard">
	<div class="sl-wizard-top">
		<h1 class="sl-wordmark">Sync<span class="sl-lab">Lab</span></h1>
		<div class="sl-steps-bar" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
			{#each STEPS as name, index (name)}
				<span class:is-done={index < step} class:is-current={index === step} title={name}></span>
			{/each}
		</div>
	</div>

	{#if step === 0}
		<section class="sl-card">
			<div class="sl-card-head sl-head-yellow">
				<div class="sl-titles"><h2>Where's your GitLab?</h2><p>Most people use GitLab.com</p></div>
			</div>
			<div class="sl-card-body">
				<div class="sl-segment" role="group" aria-label="GitLab location">
					<button class="sl-choice" type="button" aria-pressed={!selfHosted} onclick={() => (selfHosted = false)}>GitLab.com</button>
					<button class="sl-choice" type="button" aria-pressed={selfHosted} onclick={() => (selfHosted = true)}>Self-hosted</button>
				</div>
				{#if selfHosted}
					<label class="sl-label" for="sl-url">Address</label>
					<input id="sl-url" class="sl-field" type="url" placeholder="https://gitlab.example.com" bind:value={customUrl} />
				{/if}
			</div>
		</section>
		<div class="sl-wizard-actions">
			<button class="sl-btn" type="button" onclick={() => host.close()}>Cancel</button>
			<button class="sl-btn is-primary" type="button" onclick={nextFromWhere}>Next</button>
		</div>
	{:else if step === 1}
		<section class="sl-card">
			<div class="sl-card-head sl-head-pink">
				<div class="sl-titles"><h2>Connect your account</h2><p>With a personal access token</p></div>
			</div>
			<div class="sl-card-body">
				<p>SyncLab needs a token with the <b>api</b> scope. It's kept in this device's keychain, never in your vault.</p>
				<button class="sl-btn is-yellow" type="button" onclick={() => host.openUrl(tokenPageUrl(baseUrl))}><span>Create a token on GitLab</span><span class="sl-btn-icon" use:icon={'external-link'}></span></button>
				<p class="sl-hint">The page opens with the name and scope filled in. Set an expiry date, create it, then copy it here.</p>
				<label class="sl-label" for="sl-token">Token</label>
				<input id="sl-token" class="sl-field" type="password" autocomplete="off" spellcheck="false" placeholder="glpat-…" bind:value={token} />
				{#if host.existingToken && token === host.existingToken}
					<p class="sl-hint">Using the token already saved on this device.</p>
				{/if}
			</div>
		</section>
		<div class="sl-wizard-actions">
			<button class="sl-btn" type="button" onclick={() => go(0)}>Back</button>
			<button class="sl-btn is-primary" type="button" disabled={busy} onclick={connect}>{busy ? 'Connecting…' : 'Connect'}</button>
		</div>
	{:else if step === 2}
		<section class="sl-card">
			<div class="sl-card-head sl-head-blue">
				<div class="sl-titles"><h2>Pick a project</h2><p>Your notes go into this repository</p></div>
			</div>
			<div class="sl-card-body">
				{#if user}
					<div class="sl-user">
						{#if user.avatar_url}<img src={user.avatar_url} alt="" />{/if}
						<div><b>Connected as @{user.username}</b></div>
					</div>
				{/if}
				<input class="sl-field" type="search" placeholder="Search your projects" value={query} oninput={onQuery} />
				<div class="sl-results">
					{#each projects as item (item.id)}
						<button class="sl-result" type="button" aria-pressed={project?.id === item.id} onclick={() => (project = item)}>
							<span><b>{item.name}</b><small>{item.path_with_namespace}</small></span>
						</button>
					{:else}
						<p class="sl-hint">No projects found.</p>
					{/each}
				</div>
				<label class="sl-label" for="sl-new">Or create a new private project</label>
				<div class="sl-segment">
					<input id="sl-new" class="sl-field" type="text" bind:value={newProjectName} />
					<button class="sl-btn" type="button" disabled={busy} onclick={createProject}>Create</button>
				</div>
			</div>
		</section>
		<div class="sl-wizard-actions">
			<button class="sl-btn" type="button" onclick={() => go(1)}>Back</button>
			<button class="sl-btn is-primary" type="button" disabled={busy || !project} onclick={nextFromProject}>{busy ? 'Checking…' : 'Next'}</button>
		</div>
	{:else if step === 3}
		<section class="sl-card">
			<div class="sl-card-head sl-head-violet">
				<div class="sl-titles"><h2>Pick a branch</h2><p>Usually the default one</p></div>
			</div>
			<div class="sl-card-body">
				{#if branches.length > 0}
					<div class="sl-results">
						{#each branches as item (item.name)}
							<button class="sl-result" type="button" aria-pressed={branch === item.name} onclick={() => (branch = item.name)}>
								<span><b>{item.name}</b><small>{item.default ? 'Default branch' : item.protected ? 'Protected' : 'Branch'}</small></span>
							</button>
						{/each}
					</div>
					{#if selectedBranch?.protected && !selectedBranch.developers_can_push}
						<p class="sl-hint">This branch is protected. If your role can't push to it, syncs will be refused.</p>
					{/if}
				{:else}
					<p class="sl-hint">This project has no branches yet. SyncLab will create this one on the first sync.</p>
					<input class="sl-field" type="text" bind:value={branch} />
				{/if}
			</div>
		</section>
		<div class="sl-wizard-actions">
			<button class="sl-btn" type="button" onclick={() => go(2)}>Back</button>
			<button class="sl-btn is-primary" type="button" onclick={nextFromBranch}>Next</button>
		</div>
	{:else}
		<section class="sl-card">
			<div class="sl-card-head sl-head-green">
				<div class="sl-titles"><h2>What should sync?</h2><p>You can change this later</p></div>
			</div>
			<div class="sl-card-body">
				<div class="sl-segment" role="group" aria-label="What to sync">
					<button class="sl-choice" type="button" aria-pressed={wholeVault} onclick={() => (wholeVault = true)}>Whole vault</button>
					<button class="sl-choice" type="button" aria-pressed={!wholeVault} disabled={host.folders.length === 0} onclick={() => (wholeVault = false)}>One folder</button>
				</div>
				{#if !wholeVault}
					<select class="sl-field" bind:value={folder} aria-label="Folder to sync">
						{#each host.folders as item (item)}
							<option value={item}>{item}</option>
						{/each}
					</select>
				{/if}
				<label class="sl-label" for="sl-device">This device's name</label>
				<input id="sl-device" class="sl-field" type="text" bind:value={deviceName} placeholder="Laptop" />
				<ul class="sl-summary">
					<li><b>GitLab</b><span>{baseUrl.replace(/^https?:\/\//, '')}</span></li>
					<li><b>Project</b><span>{project?.path_with_namespace}</span></li>
					<li><b>Branch</b><span>{branch}</span></li>
					<li><b>Folder</b><span>{wholeVault ? 'Whole vault' : folder}</span></li>
				</ul>
				<p class="sl-hint">The first sync never deletes anything. Files that exist on both sides but differ show up as conflicts for you to decide.</p>
			</div>
		</section>
		<div class="sl-wizard-actions">
			<button class="sl-btn" type="button" onclick={() => go(3)}>Back</button>
			<button class="sl-btn is-primary" type="button" disabled={busy} onclick={finish}>{busy ? 'Saving…' : 'Connect and check'}</button>
		</div>
	{/if}

	{#if error}
		<p class="sl-error-text" role="alert">{error}</p>
	{/if}
</div>

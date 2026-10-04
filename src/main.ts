import { debounce, Notice, Platform, Plugin } from 'obsidian';
import { createIgnoreMatcher, normalizeFolder, toRepoPath, toVaultPath } from './core/paths';
import type { Change, RepoPath } from './core/types';
import { SyncEngine, type SyncRequest, type SyncSummary } from './engine/SyncEngine';
import { StateStore } from './engine/StateStore';
import { Store } from './engine/store';
import { GitLabClient, normalizeBaseUrl } from './gitlab/GitLabClient';
import { GitLabRepo } from './gitlab/GitLabRepo';
import { obsidianHttp } from './gitlab/obsidianHttp';
import { ObsidianLocalFs } from './obsidian/ObsidianLocalFs';
import { PluginStateSlots } from './obsidian/PluginStateSlots';
import { DEFAULT_SETTINGS, DEFAULT_TOKEN_SECRET, isConfigured, targetKey, type SyncLabSettings } from './settings';
import type { HostInfo, SidebarHost } from './ui/host';
import { ConfirmModal, DiffModal, SetupModal, TokenModal } from './ui/modals';
import { SyncLabSettingTab } from './ui/SettingsTab';
import { SyncLabView, VIEW_TYPE } from './ui/SyncLabView';
import { tokenPageUrl, type WizardResult } from './ui/wizard';

const DEVICE_ID_KEY = 'synclab-device-id';

export default class SyncLabPlugin extends Plugin {
	settings: SyncLabSettings = { ...DEFAULT_SETTINGS };
	readonly engine = new SyncEngine();
	readonly info = new Store<HostInfo>({ configured: false, missingToken: false, projectPath: '', branch: '', deviceName: '', version: '' });

	private deviceId = '';
	private reconfigureAfterSync = false;
	private statusBar: HTMLElement | null = null;
	private readonly localChanged = debounce(() => void this.engine.refreshLocal(), 700, true);

	async onload(): Promise<void> {
		await this.loadSettings();
		this.deviceId = this.loadDeviceId();

		this.registerView(VIEW_TYPE, leaf => new SyncLabView(leaf, this.sidebarHost()));
		this.addRibbonIcon('refresh-cw', 'Open SyncLab', () => void this.activateView());
		this.addSettingTab(new SyncLabSettingTab(this.app, this));

		this.addCommand({ id: 'open', name: 'Open sidebar', callback: () => void this.activateView() });
		this.addCommand({
			id: 'sync',
			name: 'Sync now',
			callback: async () => {
				await this.activateView();
				await this.sync({});
			},
		});
		this.addCommand({ id: 'refresh', name: 'Check for changes', callback: () => void this.engine.refresh() });
		this.addCommand({ id: 'setup', name: 'Connect to GitLab', callback: () => this.openSetup() });

		this.statusBar = this.addStatusBarItem();
		this.statusBar.addClass('mod-clickable');
		this.registerDomEvent(this.statusBar, 'click', () => void this.activateView());
		this.register(this.engine.state.subscribe(() => this.updateStatusBar()));

		this.registerEvent(this.app.vault.on('create', file => this.onVaultChange(file.path)));
		this.registerEvent(this.app.vault.on('modify', file => this.onVaultChange(file.path)));
		this.registerEvent(this.app.vault.on('delete', file => this.onVaultChange(file.path)));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			this.onVaultChange(file.path);
			this.onVaultChange(oldPath);
		}));

		this.app.workspace.onLayoutReady(() => this.reconfigure());
	}

	onunload(): void {
		this.localChanged.cancel();
	}

	async loadSettings(): Promise<void> {
		this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<SyncLabSettings> | null) };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.reconfigure();
	}

	/** Rebuilds the engine for the current settings. Waits for a running sync to finish first. */
	reconfigure(): void {
		if (this.engine.isRunning) {
			this.reconfigureAfterSync = true;
			return;
		}
		const settings = { ...this.settings };
		const token = this.storedToken();
		const ready = isConfigured(settings) && Boolean(token);
		this.info.set({
			configured: ready,
			missingToken: isConfigured(settings) && !token,
			projectPath: settings.projectPath,
			branch: settings.branch,
			deviceName: this.deviceName(),
			version: this.manifest.version,
		});

		if (!ready || !token || settings.projectId === null) {
			this.engine.configure(null);
			return;
		}

		const folder = normalizeFolder(settings.folder);
		const client = new GitLabClient({ baseUrl: settings.gitlabUrl, token, http: obsidianHttp });
		this.engine.configure({
			remote: new GitLabRepo(client, settings.projectId, settings.branch),
			local: new ObsidianLocalFs(this.app, folder),
			state: new StateStore(new PluginStateSlots(this.app.vault.adapter, this.pluginDir())),
			targetKey: targetKey(settings),
			deviceId: this.deviceId,
			deviceName: this.deviceName(),
			isIgnored: createIgnoreMatcher(settings.ignorePatterns),
			maxFileBytes: Math.max(1, settings.maxFileSizeMB) * 1024 * 1024,
		});
		if (this.app.workspace.getLeavesOfType(VIEW_TYPE).length > 0) void this.engine.refresh();
	}

	async sync(request: SyncRequest): Promise<SyncSummary> {
		const summary = await this.engine.sync({
			...request,
			confirmDeletions: (deletions, tracked) => ConfirmModal.ask(this.app, {
				title: `Delete ${deletions} files?`,
				body: `This sync would delete ${deletions} of ${tracked} synced files (in the vault or on GitLab). Deleted vault files go to the trash, and GitLab keeps them in its history.`,
				confirm: 'Delete and sync',
				danger: true,
			}),
		}).catch((error: unknown): SyncSummary => {
			new Notice(error instanceof Error ? error.message : String(error));
			return { pulled: 0, pushed: 0, deleted: 0, skipped: 0, failed: 0, conflicts: 0, cancelled: true };
		});

		if (summary.error) new Notice(`SyncLab: ${summary.error}`, 8000);
		else if (summary.failed) new Notice(`SyncLab: ${summary.failed} file(s) couldn't sync. See Activity for details.`, 8000);

		if (this.reconfigureAfterSync) {
			this.reconfigureAfterSync = false;
			this.reconfigure();
		}
		return summary;
	}

	openSetup(): void {
		const existing = this.storedToken();
		new SetupModal(this.app, {
			initialUrl: this.settings.gitlabUrl,
			initialFolder: this.settings.folder,
			initialDeviceName: this.deviceName(),
			existingToken: existing,
			folders: this.app.vault.getAllFolders(false).map(f => f.path).sort((a, b) => a.localeCompare(b)),
			client: (url, token) => new GitLabClient({ baseUrl: url, token, http: obsidianHttp }),
			openUrl: url => window.open(url),
			finish: result => this.finishSetup(result),
		}).open();
	}

	/** Whether this device's keychain holds a GitLab token for SyncLab. */
	hasToken(): boolean {
		return Boolean(this.storedToken());
	}

	/** Lets the user paste a new token; it's checked with GitLab before it's saved. */
	openTokenModal(onSaved?: () => void): void {
		const baseUrl = normalizeBaseUrl(this.settings.gitlabUrl);
		new TokenModal(this.app, {
			hasToken: this.hasToken(),
			tokenPageUrl: tokenPageUrl(baseUrl),
			openUrl: url => window.open(url),
			check: async token => (await new GitLabClient({ baseUrl, token, http: obsidianHttp }).currentUser()).username,
			save: async token => {
				this.app.secretStorage.setSecret(this.tokenSecretName(), token);
				if (this.settings.tokenSecret !== this.tokenSecretName()) {
					this.settings.tokenSecret = this.tokenSecretName();
					await this.saveData(this.settings);
				}
				this.reconfigure();
				onSaved?.();
			},
		}).open();
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
	}

	private async finishSetup(result: WizardResult): Promise<void> {
		this.app.secretStorage.setSecret(this.tokenSecretName(), result.token);
		this.settings = {
			...this.settings,
			gitlabUrl: normalizeBaseUrl(result.gitlabUrl),
			tokenSecret: this.tokenSecretName(),
			projectId: result.project.id,
			projectPath: result.project.path_with_namespace,
			projectWebUrl: result.project.web_url,
			branch: result.branch,
			folder: normalizeFolder(result.folder),
			deviceName: result.deviceName,
		};
		await this.saveSettings();
		await this.activateView();
		new Notice('SyncLab is connected. Review your changes, then sync.');
	}

	private sidebarHost(): SidebarHost {
		return {
			engine: this.engine,
			info: this.info,
			sync: request => this.sync(request),
			refresh: () => void this.engine.refresh(),
			openDiff: change => void this.openDiff(change),
			openFile: path => void this.openFile(path),
			openSetup: () => this.openSetup(),
			replaceToken: () => this.openTokenModal(),
			openSettings: () => this.openSettingsTab(),
			openOnGitLab: () => {
				if (this.settings.projectWebUrl) window.open(`${this.settings.projectWebUrl}/-/tree/${encodeURIComponent(this.settings.branch)}`);
			},
		};
	}

	private async openDiff(change: Change): Promise<void> {
		try {
			await DiffModal.open(this.app, this.engine, change);
		} catch (error) {
			new Notice(`Couldn't load ${change.path}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async openFile(path: RepoPath): Promise<void> {
		const file = this.app.vault.getFileByPath(toVaultPath(path, normalizeFolder(this.settings.folder)));
		if (file) await this.app.workspace.getLeaf(false).openFile(file);
	}

	private openSettingsTab(): void {
		// The settings modal API isn't in the public typings.
		const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
		setting?.open();
		setting?.openTabById(this.manifest.id);
	}

	private onVaultChange(path: string): void {
		if (this.engine.isRunning || !this.info.get().configured) return;
		if (toRepoPath(path, normalizeFolder(this.settings.folder)) === null) return;
		this.localChanged();
	}

	private updateStatusBar(): void {
		if (!this.statusBar) return;
		const state = this.engine.state.get();
		if (!state.configured) this.statusBar.setText('SyncLab: not connected');
		else if (state.phase === 'syncing') this.statusBar.setText('SyncLab: syncing…');
		else if (state.error) this.statusBar.setText('SyncLab: offline');
		else this.statusBar.setText(state.changes.length ? `SyncLab: ${state.changes.length} to sync` : 'SyncLab: in sync');
	}

	private deviceName(): string {
		return this.settings.deviceName || (Platform.isMobile ? 'Phone' : 'Desktop');
	}

	private loadDeviceId(): string {
		const existing: unknown = this.app.loadLocalStorage(DEVICE_ID_KEY);
		if (typeof existing === 'string' && existing) return existing;
		const id = crypto.randomUUID();
		this.app.saveLocalStorage(DEVICE_ID_KEY, id);
		return id;
	}

	/** The keychain entry SyncLab uses. Falls back to the default if the setting isn't a valid name. */
	private tokenSecretName(): string {
		return /^[a-z0-9-]+$/.test(this.settings.tokenSecret) ? this.settings.tokenSecret : DEFAULT_TOKEN_SECRET;
	}

	private storedToken(): string | null {
		return this.app.secretStorage.getSecret(this.tokenSecretName());
	}

	private pluginDir(): string {
		return this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
	}
}

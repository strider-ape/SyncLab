import { PluginSettingTab, Setting, type App, type ButtonComponent, type SettingDefinitionItem } from 'obsidian';
import { normalizeFolder } from '../core/paths';
import type SyncLabPlugin from '../main';
import type { SyncLabSettings } from '../settings';

/** Wording shared by both settings renderers so they never drift apart. */
const TEXT = {
	connection: 'Connection',
	token: 'GitLab token',
	tokenDesc: 'Kept in this device\'s keychain, never in your vault. The token needs API access.',
	tokenSaved: 'Saved in this device\'s keychain, never in your vault. Replace it when it expires, or if it may have leaked.',
	tokenMissing: 'No token on this device yet. SyncLab needs one with API access to reach GitLab.',
	folder: 'Folder to sync',
	folderDesc: 'Empty means the whole vault. Changing it starts a fresh sync history, which never deletes anything.',
	ignore: 'Files to ignore',
	ignoreDesc: 'One pattern per line, written like a .gitignore file. Ignored files are never synced, and never deleted on either side.',
	device: 'Device name',
	deviceDesc: 'Added to commit messages so you can tell where a change came from.',
	size: 'Largest file to sync',
	sizeDesc: 'In megabytes. Bigger files are left alone on both sides.',
};

/** Settings keys the declarative controls may write, with how each value is cleaned. */
const asText = (value: unknown): string => (typeof value === 'string' ? value : '');
const CLEAN: Partial<Record<keyof SyncLabSettings, (value: unknown) => unknown>> = {
	folder: value => normalizeFolder(asText(value)),
	ignorePatterns: value => asText(value),
	deviceName: value => asText(value).trim(),
	maxFileSizeMB: value => Math.min(100, Math.max(1, Math.round(Number(value) || 20))),
};

export class SyncLabSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: SyncLabPlugin) {
		super(app, plugin);
	}

	/** Obsidian 1.13+: declarative settings, which also makes them searchable. */
	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: TEXT.connection, desc: this.connectionText(), render: setting => this.addSetupButton(setting) },
			{ name: TEXT.token, desc: TEXT.tokenDesc, aliases: ['secret', 'access token', 'keychain'], render: setting => this.addTokenRow(setting) },
			{ name: TEXT.folder, desc: TEXT.folderDesc, control: { type: 'folder', key: 'folder', placeholder: 'Whole vault' } },
			{ name: TEXT.ignore, desc: TEXT.ignoreDesc, aliases: ['gitignore', 'exclude'], control: { type: 'textarea', key: 'ignorePatterns', placeholder: 'drafts/\n*.tmp', rows: 5 } },
			{ name: TEXT.device, desc: TEXT.deviceDesc, control: { type: 'text', key: 'deviceName', placeholder: 'Laptop' } },
			{ name: TEXT.size, desc: TEXT.sizeDesc, control: { type: 'slider', key: 'maxFileSizeMB', min: 1, max: 100, step: 1, displayFormat: value => `${value} MB` } },
		];
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		const clean = CLEAN[key as keyof SyncLabSettings];
		if (!clean) return;
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = clean(value);
		await this.plugin.saveSettings();
	}

	/** Obsidian 1.11 and 1.12: the classic imperative settings page. */
	display(): void {
		const { containerEl } = this;
		const settings = this.plugin.settings;
		containerEl.empty();

		this.addSetupButton(new Setting(containerEl).setName(TEXT.connection).setDesc(this.connectionText()));
		this.addTokenRow(new Setting(containerEl).setName(TEXT.token));

		new Setting(containerEl)
			.setName(TEXT.folder)
			.setDesc(TEXT.folderDesc)
			.addText(text => text
				.setPlaceholder('Whole vault')
				.setValue(settings.folder)
				.onChange(value => this.setControlValue('folder', value)));

		new Setting(containerEl)
			.setName(TEXT.ignore)
			.setDesc(TEXT.ignoreDesc)
			.addTextArea(area => {
				area.inputEl.rows = 5;
				area
					.setPlaceholder('drafts/\n*.tmp')
					.setValue(settings.ignorePatterns)
					.onChange(value => this.setControlValue('ignorePatterns', value));
			});

		new Setting(containerEl)
			.setName(TEXT.device)
			.setDesc(TEXT.deviceDesc)
			.addText(text => text
				.setPlaceholder('Laptop')
				.setValue(settings.deviceName)
				.onChange(value => this.setControlValue('deviceName', value)));

		new Setting(containerEl)
			.setName(TEXT.size)
			.setDesc(TEXT.sizeDesc)
			.addSlider(slider => slider
				.setLimits(1, 100, 1)
				.setValue(settings.maxFileSizeMB)
				.onChange(value => this.setControlValue('maxFileSizeMB', value)));
	}

	private connectionText(): string {
		const settings = this.plugin.settings;
		return settings.projectId !== null
			? `${settings.projectPath}, branch ${settings.branch}, on ${settings.gitlabUrl.replace(/^https?:\/\//, '')}.`
			: 'Not connected to GitLab yet.';
	}

	private addSetupButton(setting: Setting): void {
		setting.addButton(button => button
			.setButtonText(this.plugin.settings.projectId !== null ? 'Run setup again' : 'Connect GitLab')
			.setCta()
			.onClick(() => this.plugin.openSetup()));
	}

	/** Status plus one button; updates in place after a new token is saved. */
	private addTokenRow(setting: Setting): void {
		let button: ButtonComponent | undefined;
		const refresh = () => {
			const saved = this.plugin.hasToken();
			setting.setDesc(saved ? TEXT.tokenSaved : TEXT.tokenMissing);
			button?.setButtonText(saved ? 'Replace token' : 'Add token');
		};
		setting.addButton(created => {
			button = created;
			created.onClick(() => this.plugin.openTokenModal(refresh));
		});
		refresh();
	}
}

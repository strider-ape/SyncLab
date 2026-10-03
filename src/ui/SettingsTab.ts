import { PluginSettingTab, SecretComponent, Setting, type App } from 'obsidian';
import { normalizeFolder } from '../core/paths';
import type SyncLabPlugin from '../main';

export class SyncLabSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: SyncLabPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const settings = this.plugin.settings;
		containerEl.empty();

		const connected = settings.projectId !== null;
		new Setting(containerEl)
			.setName('Connection')
			.setDesc(connected
				? `${settings.projectPath}, branch ${settings.branch}, on ${settings.gitlabUrl.replace(/^https?:\/\//, '')}.`
				: 'Not connected to GitLab yet.')
			.addButton(button => button
				.setButtonText(connected ? 'Run setup again' : 'Connect GitLab')
				.setCta()
				.onClick(() => this.plugin.openSetup()));

		new Setting(containerEl)
			.setName('GitLab token')
			.setDesc('Kept in Obsidian\'s keychain on this device, never in your vault. The token needs API access.')
			.addComponent(el => new SecretComponent(this.app, el)
				.setValue(settings.tokenSecret)
				.onChange(async value => {
					settings.tokenSecret = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Folder to sync')
			.setDesc('Empty means the whole vault. Changing it starts a fresh sync history, which never deletes anything.')
			.addText(text => text
				.setPlaceholder('Whole vault')
				.setValue(settings.folder)
				.onChange(async value => {
					settings.folder = normalizeFolder(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Files to ignore')
			.setDesc('One pattern per line, written like a .gitignore file. Ignored files are never synced, and never deleted on either side.')
			.addTextArea(area => {
				area.inputEl.rows = 5;
				area
					.setPlaceholder('drafts/\n*.tmp')
					.setValue(settings.ignorePatterns)
					.onChange(async value => {
						settings.ignorePatterns = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Device name')
			.setDesc('Added to commit messages so you can tell where a change came from.')
			.addText(text => text
				.setPlaceholder('Laptop')
				.setValue(settings.deviceName)
				.onChange(async value => {
					settings.deviceName = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Largest file to sync')
			.setDesc('In megabytes. Bigger files are left alone on both sides.')
			.addSlider(slider => slider
				.setLimits(1, 100, 1)
				.setValue(settings.maxFileSizeMB)
				.onChange(async value => {
					settings.maxFileSizeMB = value;
					await this.plugin.saveSettings();
				}));
	}
}

import { normalizePath, type DataAdapter } from 'obsidian';
import type { StateSlots } from '../engine/StateStore';

/** The two state files live in the plugin's own folder, next to data.json. */
export class PluginStateSlots implements StateSlots {
	constructor(private readonly adapter: DataAdapter, private readonly pluginDir: string) {}

	async read(slot: 'a' | 'b'): Promise<string | null> {
		const path = this.path(slot);
		return (await this.adapter.exists(path)) ? this.adapter.read(path) : null;
	}

	async write(slot: 'a' | 'b', text: string): Promise<void> {
		await this.adapter.write(this.path(slot), text);
	}

	private path(slot: 'a' | 'b'): string {
		return normalizePath(`${this.pluginDir}/sync-state-${slot}.json`);
	}
}

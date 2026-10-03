import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { mount, unmount } from 'svelte';
import Sidebar from './components/Sidebar.svelte';
import type { SidebarHost } from './host';

/** Kept stable: Obsidian stores it in workspace layouts. */
export const VIEW_TYPE = 'synclab-view';

export class SyncLabView extends ItemView {
	private component: ReturnType<typeof mount> | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly host: SidebarHost) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'SyncLab';
	}

	getIcon(): string {
		return 'refresh-cw';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClasses(['synclab', 'synclab-host']);
		this.component = mount(Sidebar, { target: this.contentEl, props: { host: this.host } });
		this.host.refresh();
	}

	async onClose(): Promise<void> {
		if (this.component) await unmount(this.component);
		this.component = null;
	}
}

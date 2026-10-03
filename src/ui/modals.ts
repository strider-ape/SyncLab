import { Modal, type App } from 'obsidian';
import { mount, unmount } from 'svelte';
import type { Change } from '../core/types';
import type { SyncEngine } from '../engine/SyncEngine';
import DiffView from './components/DiffView.svelte';
import Wizard from './components/Wizard.svelte';
import type { WizardHost } from './wizard';

type Mounted = ReturnType<typeof mount>;

/** A modal styled as a SyncLab panel, hosting one Svelte component. */
abstract class SvelteModal extends Modal {
	private component: Mounted | null = null;

	protected constructor(app: App, wide = false) {
		super(app);
		this.modalEl.addClasses(['synclab', 'synclab-modal']);
		if (wide) this.modalEl.addClass('is-wide');
	}

	protected abstract create(target: HTMLElement): Mounted;

	onOpen(): void {
		this.component = this.create(this.contentEl);
	}

	onClose(): void {
		if (this.component) void unmount(this.component);
		this.component = null;
		this.contentEl.empty();
	}
}

export class SetupModal extends SvelteModal {
	constructor(app: App, private readonly host: Omit<WizardHost, 'close'>) {
		super(app);
	}

	protected create(target: HTMLElement): Mounted {
		return mount(Wizard, { target, props: { host: { ...this.host, close: () => this.close() } } });
	}
}

export class DiffModal extends SvelteModal {
	constructor(app: App, private readonly change: Change, private readonly content: { local: ArrayBuffer | null; remote: ArrayBuffer | null }) {
		super(app, true);
	}

	static async open(app: App, engine: SyncEngine, change: Change): Promise<void> {
		const content = await engine.contents(change);
		new DiffModal(app, change, content).open();
	}

	protected create(target: HTMLElement): Mounted {
		return mount(DiffView, {
			target,
			props: { path: this.change.path, remote: this.content.remote, local: this.content.local, onClose: () => this.close() },
		});
	}
}

/** Yes/no question. Closing it any other way (Esc, clicking outside) counts as no. */
export class ConfirmModal extends Modal {
	private answered = false;

	private constructor(app: App, private readonly options: { title: string; body: string; confirm: string; danger?: boolean }, private readonly resolve: (ok: boolean) => void) {
		super(app);
		this.modalEl.addClasses(['synclab', 'synclab-modal']);
	}

	static ask(app: App, options: { title: string; body: string; confirm: string; danger?: boolean }): Promise<boolean> {
		return new Promise(resolve => new ConfirmModal(app, options, resolve).open());
	}

	onOpen(): void {
		const root = this.contentEl.createDiv({ cls: 'sl-wizard' });
		const card = root.createEl('section', { cls: 'sl-card' });
		const head = card.createDiv({ cls: `sl-card-head ${this.options.danger ? 'sl-head-red' : 'sl-head-yellow'}` });
		head.createDiv({ cls: 'sl-titles' }).createEl('h2', { text: this.options.title });
		card.createDiv({ cls: 'sl-card-body' }).createEl('p', { text: this.options.body });

		const actions = root.createDiv({ cls: 'sl-wizard-actions' });
		const cancel = actions.createEl('button', { cls: 'sl-btn', text: 'Cancel', attr: { type: 'button' } });
		const confirm = actions.createEl('button', {
			cls: `sl-btn ${this.options.danger ? 'is-danger' : 'is-primary'}`,
			text: this.options.confirm,
			attr: { type: 'button' },
		});
		cancel.addEventListener('click', () => this.close());
		confirm.addEventListener('click', () => {
			this.answered = true;
			this.resolve(true);
			this.close();
		});
	}

	onClose(): void {
		if (!this.answered) this.resolve(false);
		this.contentEl.empty();
	}
}

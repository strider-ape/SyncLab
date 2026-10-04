import { Modal, Notice, setIcon, type App } from 'obsidian';
import { mount, unmount } from 'svelte';
import type { Change } from '../core/types';
import type { SyncEngine } from '../engine/SyncEngine';
import DiffView from './components/DiffView.svelte';
import Wizard from './components/Wizard.svelte';
import { explain, type WizardHost } from './wizard';

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

export interface TokenModalOptions {
	hasToken: boolean;
	tokenPageUrl: string;
	openUrl(url: string): void;
	/** Checks the token with GitLab and returns the account's username. */
	check(token: string): Promise<string>;
	save(token: string): Promise<void>;
}

/**
 * Adds or replaces the GitLab token. One big password field, checked with
 * GitLab before anything is saved, so a typo or a token without API access
 * never replaces a working one.
 */
export class TokenModal extends Modal {
	constructor(app: App, private readonly options: TokenModalOptions) {
		super(app);
		this.modalEl.addClasses(['synclab', 'synclab-modal']);
	}

	onOpen(): void {
		const { options } = this;
		const root = this.contentEl.createDiv({ cls: 'sl-wizard' });
		const card = root.createEl('section', { cls: 'sl-card' });
		const head = card.createDiv({ cls: 'sl-card-head sl-head-pink' });
		const titles = head.createDiv({ cls: 'sl-titles' });
		titles.createEl('h2', { text: options.hasToken ? 'Replace your GitLab token' : 'Add your GitLab token' });
		titles.createEl('p', { text: 'Kept in this device’s keychain, never in your vault' });

		const body = card.createDiv({ cls: 'sl-card-body' });
		body.createEl('p', { text: 'Create a token with API access, then paste it below. SyncLab checks it with GitLab before saving it.' });
		const create = body.createEl('button', { cls: 'sl-btn is-yellow', attr: { type: 'button' } });
		create.createSpan({ text: 'Create a token on GitLab' });
		setIcon(create.createSpan({ cls: 'sl-btn-icon' }), 'external-link');
		create.addEventListener('click', () => options.openUrl(options.tokenPageUrl));
		body.createEl('label', { cls: 'sl-label', text: 'New token', attr: { for: 'synclab-new-token' } });
		const input = body.createEl('input', {
			cls: 'sl-field',
			attr: { id: 'synclab-new-token', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'Paste the new token here' },
		});
		const error = body.createEl('p', { cls: 'sl-error-text' });
		error.hide();

		const actions = root.createDiv({ cls: 'sl-wizard-actions' });
		const cancel = actions.createEl('button', { cls: 'sl-btn', text: 'Cancel', attr: { type: 'button' } });
		const save = actions.createEl('button', { cls: 'sl-btn is-primary', text: 'Check and save', attr: { type: 'button' } });
		cancel.addEventListener('click', () => this.close());

		const submit = async () => {
			const token = input.value.trim();
			error.hide();
			if (!token) {
				error.setText('Paste your token first.');
				error.show();
				return;
			}
			save.disabled = true;
			save.setText('Checking…');
			try {
				const username = await options.check(token);
				await options.save(token);
				new Notice(`SyncLab: token saved. Connected as @${username}.`);
				this.close();
			} catch (e) {
				error.setText(explain(e, 'token'));
				error.show();
				save.disabled = false;
				save.setText('Check and save');
			}
		};
		save.addEventListener('click', () => void submit());
		input.addEventListener('keydown', event => {
			if (event.key === 'Enter') void submit();
		});
		window.setTimeout(() => input.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
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

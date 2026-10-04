// Just enough of the Obsidian API for the browser preview. Icons are from Lucide (ISC license).
const ICONS: Record<string, string> = {
	'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
	'git-branch': '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
	settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
	check: '<path d="M20 6 9 17l-5-5"/>',
	'external-link': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
};

export function setIcon(el: HTMLElement, name: string): void {
	el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="svg-icon">${ICONS[name] ?? ''}</svg>`;
}

declare global {
	interface HTMLElement { empty(): void }
}
HTMLElement.prototype.empty = function (this: HTMLElement) { this.replaceChildren(); };

// Obsidian's DOM helpers and a minimal Modal, enough to render SyncLab's own modals in the preview.
type ElOptions = string | { cls?: string; text?: string; attr?: Record<string, string> };
function build<T extends HTMLElement>(parent: HTMLElement, el: T, options?: ElOptions): T {
	if (typeof options === 'string') el.className = options;
	else if (options) {
		if (options.cls) el.className = options.cls;
		if (options.text !== undefined) el.textContent = options.text;
		for (const [name, value] of Object.entries(options.attr ?? {})) el.setAttribute(name, value);
	}
	parent.appendChild(el);
	return el;
}
const helpers: Record<string, unknown> = {
	createEl(this: HTMLElement, tag: string, options?: ElOptions) { return build(this, document.createElement(tag), options); },
	createDiv(this: HTMLElement, options?: ElOptions) { return build(this, document.createElement('div'), options); },
	createSpan(this: HTMLElement, options?: ElOptions) { return build(this, document.createElement('span'), options); },
	setText(this: HTMLElement, text: string) { this.textContent = text; },
	hide(this: HTMLElement) { this.style.display = 'none'; },
	show(this: HTMLElement) { this.style.display = ''; },
	addClass(this: HTMLElement, cls: string) { this.classList.add(cls); },
	addClasses(this: HTMLElement, classes: string[]) { this.classList.add(...classes); },
};
for (const [name, fn] of Object.entries(helpers)) {
	if (!(name in HTMLElement.prototype)) Object.defineProperty(HTMLElement.prototype, name, { value: fn, configurable: true });
}

export class Notice {
	constructor(message: string) {
		document.title = message;
	}
}

export class Modal {
	modalEl: HTMLElement = document.createElement('div');
	contentEl: HTMLElement;
	constructor(readonly app: unknown) {
		this.modalEl.className = 'modal';
		this.contentEl = this.modalEl.appendChild(document.createElement('div'));
		this.contentEl.className = 'modal-content';
	}
	open(): void {
		const layer = document.getElementById('modal-layer') as HTMLElement;
		layer.replaceChildren(this.modalEl);
		layer.hidden = false;
		this.onOpen();
	}
	close(): void {
		this.onClose();
		this.modalEl.remove();
		(document.getElementById('modal-layer') as HTMLElement).hidden = true;
	}
	onOpen(): void {}
	onClose(): void {}
}

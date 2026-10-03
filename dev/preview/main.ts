// Browser preview of the real SyncLab components, driven by the in-memory fake GitLab.
import './obsidian-stub';
import { mount, unmount } from 'svelte';
import Sidebar from '../../src/ui/components/Sidebar.svelte';
import Wizard from '../../src/ui/components/Wizard.svelte';
import DiffView from '../../src/ui/components/DiffView.svelte';
import { Store } from '../../src/engine/store';
import { GitLabError, type GitLabClient, type GitLabProject } from '../../src/gitlab/GitLabClient';
import type { HostInfo, SidebarHost } from '../../src/ui/host';
import { FakeGitLab, makeDevice, type Device } from '../../tests/support/fakes';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const BASE: Record<string, string> = {
	'Daily/2026-10-03.md': '# Friday\n\nShipped the plan.\n',
	'Projects/plan.md': '# Plan\n\n- Sidebar\n- Sync button\n',
	'Projects/roadmap.md': '# Roadmap\n\nv0.1: sync\n',
	'Old/scratch.md': 'scratch\n',
	'Ideas/list.md': '# Ideas\n\n- one button\n',
};

async function seed(): Promise<Device> {
	const remote = new FakeGitLab();
	await remote.externalCommit(BASE);
	const device = makeDevice(remote, { deviceName: 'Laptop' });
	for (const [path, text] of Object.entries(BASE)) device.vault.set(path, text);
	await device.engine.sync({});

	device.vault.set('Daily/2026-10-04.md', '# Saturday\n\nSketched SyncLab.\n');
	device.vault.set('Ideas/list.md', '# Ideas\n\n- one button\n- neo-brutal cards\n');
	device.vault.remove('Old/scratch.md');
	device.vault.set('Projects/plan.md', '# Plan\n\n- Sidebar\n- Sync button\n- Conflict cards\n');
	await remote.externalCommit({
		'Projects/plan.md': '# Plan\n\n- Sidebar (done)\n- Sync button\n',
		'Projects/roadmap.md': '# Roadmap\n\nv0.1: sync\nv0.2: mobile polish\n',
	});

	// Slow the fake network down so progress is visible.
	for (const method of ['head', 'blob', 'fileInfo', 'commit'] as const) {
		const original = (remote[method] as (...args: unknown[]) => Promise<unknown>).bind(remote);
		(remote as unknown as Record<string, unknown>)[method] = async (...args: unknown[]) => {
			await delay(method === 'commit' ? 700 : 250);
			return original(...args);
		};
	}
	device.engine.clearLog();
	await device.engine.refresh();
	return device;
}

const sidebarTarget = document.getElementById('sidebar') as HTMLElement;
const modalLayer = document.getElementById('modal-layer') as HTMLElement;
const modalTarget = document.getElementById('modal') as HTMLElement;
let sidebar: ReturnType<typeof mount> | null = null;
let modal: ReturnType<typeof mount> | null = null;
const info = new Store<HostInfo>({ configured: true, missingToken: false, projectPath: 'dip/notes-vault', branch: 'main', deviceName: 'Laptop' });

function closeModal() {
	if (modal) void unmount(modal);
	modal = null;
	modalLayer.hidden = true;
	modalTarget.parentElement?.classList.remove('is-wide');
}

const projects: GitLabProject[] = [
	{ id: 1, name: 'notes-vault', path_with_namespace: 'dip/notes-vault', web_url: '', default_branch: 'main' },
	{ id: 2, name: 'work-notes', path_with_namespace: 'team/work-notes', web_url: '', default_branch: 'main' },
	{ id: 3, name: 'dotfiles', path_with_namespace: 'dip/dotfiles', web_url: '', default_branch: 'master' },
];

const fakeClient = {
	async currentUser() {
		await delay(600);
		return { id: 1, username: 'dip', name: 'Dip' };
	},
	async searchProjects(query: string) {
		await delay(200);
		return projects.filter(p => p.path_with_namespace.includes(query.toLowerCase()));
	},
	async getProject(id: number) {
		await delay(300);
		const project = projects.find(p => p.id === id);
		if (!project) throw new GitLabError('not-found', 'Not found', 404);
		return { ...project, permissions: { project_access: { access_level: 40 } } };
	},
	async createProject(name: string) {
		await delay(500);
		const project = { id: 99, name, path_with_namespace: `dip/${name.toLowerCase().replace(/\s+/g, '-')}`, web_url: '', default_branch: 'main' };
		projects.unshift(project);
		return project;
	},
	async listBranches() {
		await delay(300);
		return [
			{ name: 'main', default: true, protected: true, developers_can_push: false, commit: { id: 'a' } },
			{ name: 'notes', default: false, protected: false, developers_can_push: true, commit: { id: 'b' } },
		];
	},
} as unknown as GitLabClient;

function openWizard() {
	closeModal();
	modalLayer.hidden = false;
	modal = mount(Wizard, {
		target: modalTarget,
		props: {
			host: {
				initialUrl: 'https://gitlab.com',
				initialFolder: '',
				initialDeviceName: 'Laptop',
				existingToken: null,
				folders: ['Daily', 'Ideas', 'Projects'],
				client: () => fakeClient,
				openUrl: (url: string) => void window.open(url),
				finish: async () => { await delay(400); },
				close: closeModal,
			},
		},
	});
}

async function start() {
	if (sidebar) await unmount(sidebar);
	sidebarTarget.replaceChildren();
	const device = await seed();
	const host: SidebarHost = {
		engine: device.engine,
		info,
		sync: request => device.engine.sync({ ...request, confirmDeletions: async n => window.confirm(`Delete ${n} files?`) }),
		refresh: () => void device.engine.refresh(),
		openDiff: async change => {
			const content = await device.engine.contents(change);
			closeModal();
			modalLayer.hidden = false;
			modalTarget.parentElement?.classList.add('is-wide');
			modal = mount(DiffView, { target: modalTarget, props: { path: change.path, remote: content.remote, local: content.local, onClose: closeModal } });
		},
		openFile: () => undefined,
		openSetup: openWizard,
		openSettings: () => undefined,
		openOnGitLab: () => undefined,
	};
	sidebar = mount(Sidebar, { target: sidebarTarget, props: { host } });
}

document.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach(button => button.addEventListener('click', () => {
	document.body.classList.toggle('theme-dark', button.dataset.theme === 'dark');
	document.body.classList.toggle('theme-light', button.dataset.theme !== 'dark');
}));
document.querySelectorAll<HTMLButtonElement>('[data-width]').forEach(button => button.addEventListener('click', () => {
	document.documentElement.style.setProperty('--preview-sidebar', `${button.dataset.width}px`);
}));
document.getElementById('show-wizard')?.addEventListener('click', openWizard);
document.getElementById('show-welcome')?.addEventListener('click', () => {
	const current = info.get();
	info.set({ ...current, configured: !current.configured });
});
document.getElementById('reset')?.addEventListener('click', () => void start());
modalLayer.addEventListener('click', event => { if (event.target === modalLayer) closeModal(); });

void start();

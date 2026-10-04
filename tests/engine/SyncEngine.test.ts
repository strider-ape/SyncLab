import { describe, expect, it } from 'vitest';
import type { Resolution } from '../../src/core/types';
import { FakeGitLab, FakeVault, MemorySlots, makeDevice, type Device } from '../support/fakes';

const map = (entries: Record<string, string>) => new Map(Object.entries(entries));

async function synced(device: Device, resolutions: Record<string, Resolution> = {}) {
	const summary = await device.engine.sync({ resolutions: new Map(Object.entries(resolutions)), confirmDeletions: async () => true });
	expect(summary.error).toBeUndefined();
	return summary;
}

describe('first sync', () => {
	it('pushes local-only files, pulls remote-only files and adopts identical ones', async () => {
		const remote = new FakeGitLab();
		await remote.externalCommit({ 'shared.md': 'same', 'remote.md': 'from gitlab' });
		const d = makeDevice(remote);
		d.vault.set('shared.md', 'same');
		d.vault.set('local.md', 'from vault');

		const summary = await synced(d);

		expect(summary).toMatchObject({ pulled: 1, pushed: 1, deleted: 0, conflicts: 0 });
		expect(remote.files()).toEqual(map({ 'local.md': 'from vault', 'remote.md': 'from gitlab', 'shared.md': 'same' }));
		expect(d.vault.snapshot()).toEqual(remote.files());
	});

	it('turns files that differ into conflicts instead of overwriting either side', async () => {
		const remote = new FakeGitLab();
		await remote.externalCommit({ 'note.md': 'gitlab version' });
		const d = makeDevice(remote);
		d.vault.set('note.md', 'vault version');

		const summary = await synced(d);

		expect(summary.conflicts).toBe(1);
		expect(d.vault.get('note.md')).toBe('vault version');
		expect(remote.files().get('note.md')).toBe('gitlab version');
		expect(remote.commits).toHaveLength(1);
	});

	it('pulls an existing GitLab project into an empty vault on a new device', async () => {
		const remote = new FakeGitLab();
		const notes: Record<string, string | Uint8Array> = { 'Attachments/picture.bin': Uint8Array.from({ length: 5000 }, (_, i) => i % 251) };
		for (let i = 0; i < 40; i++) notes[`Area ${i % 5}/Topic/note ${i}.md`] = `# Note ${i}
`;
		await remote.externalCommit(notes);
		const phone = makeDevice(remote, { deviceId: 'phone' });

		const summary = await synced(phone);

		expect(summary).toMatchObject({ pulled: 41, pushed: 0, deleted: 0, conflicts: 0, failed: 0 });
		expect(phone.vault.snapshot()).toEqual(remote.files());
		expect(remote.commits).toHaveLength(1);
		expect(remote.maxInFlight).toBeGreaterThan(1);
		expect(remote.maxInFlight).toBeLessThanOrEqual(6);
		expect((await synced(phone)).pulled).toBe(0);
	});

	it('never deletes anything when there is no sync history', async () => {
		const remote = new FakeGitLab();
		await remote.externalCommit({ 'only-remote.md': 'x' });
		const d = makeDevice(remote);
		d.vault.set('only-local.md', 'y');

		const summary = await synced(d);
		expect(summary.deleted).toBe(0);
		expect(d.vault.trashed).toEqual([]);
	});
});

describe('idempotency', () => {
	it('a second sync with no new edits makes no commits and no writes', async () => {
		const remote = new FakeGitLab();
		await remote.externalCommit({ 'a.md': 'a' });
		const d = makeDevice(remote);
		d.vault.set('b.md', 'b');
		await synced(d);

		const commits = remote.commits.length;
		const writes = d.vault.writes;
		const summary = await synced(d);

		expect(summary).toMatchObject({ pulled: 0, pushed: 0, deleted: 0 });
		expect(remote.commits.length).toBe(commits);
		expect(d.vault.writes).toBe(writes);
	});

	it('a lost commit response is not committed twice', async () => {
		const remote = new FakeGitLab();
		await remote.externalCommit({ 'a.md': 'a' });
		const d = makeDevice(remote);
		await synced(d);
		d.vault.set('a.md', 'edited');

		remote.dropNextCommitResponse = 'after-apply';
		await synced(d);

		expect(remote.commits).toHaveLength(2);
		expect(remote.files().get('a.md')).toBe('edited');
		const again = await synced(d);
		expect(again.pushed).toBe(0);
		expect(remote.commits).toHaveLength(2);
	});

	it('recovers cleanly when SyncLab stopped right after a commit landed', async () => {
		const remote = new FakeGitLab();
		await remote.externalCommit({ 'a.md': 'a' });
		const slots = new MemorySlots();
		const vault = new FakeVault();
		const first = makeDevice(remote, { slots, vault });
		await synced(first);

		vault.set('a.md', 'edited');
		// The commit lands, then the state file can't be written (e.g. the app was closed).
		const saveAfterCommitFails = remote.commit.bind(remote);
		remote.commit = async (message, actions) => {
			const result = await saveAfterCommitFails(message, actions);
			slots.failWrites = true;
			return result;
		};
		const crashed = await first.engine.sync();
		expect(crashed.error).toBeDefined();
		expect(remote.files().get('a.md')).toBe('edited');

		// Restart: a new engine with the same state slots.
		slots.failWrites = false;
		remote.commit = saveAfterCommitFails;
		vault.set('a.md', 'edited again');
		const restarted = makeDevice(remote, { slots, vault });
		const summary = await synced(restarted);

		expect(summary.conflicts).toBe(0);
		expect(summary.pushed).toBe(1);
		expect(remote.files().get('a.md')).toBe('edited again');
	});
});

describe('one-sided changes', () => {
	it('pushes local edits and deletes, and pulls remote edits and deletes', async () => {
		const remote = new FakeGitLab();
		await remote.externalCommit({ 'edit-here.md': '1', 'delete-here.md': '1', 'edit-there.md': '1', 'delete-there.md': '1' });
		const d = makeDevice(remote);
		await synced(d);

		d.vault.set('edit-here.md', '2');
		d.vault.remove('delete-here.md');
		await remote.externalCommit({ 'edit-there.md': '2', 'delete-there.md': null });

		const summary = await synced(d);

		expect(summary).toMatchObject({ pushed: 1, pulled: 1, deleted: 2, conflicts: 0 });
		expect(remote.files()).toEqual(map({ 'edit-here.md': '2', 'edit-there.md': '2' }));
		expect(d.vault.snapshot()).toEqual(remote.files());
		expect(d.vault.trashed.map(t => t.path)).toEqual(['delete-there.md']);
	});

	it('uses one commit for every local change and a move for a renamed file', async () => {
		const remote = new FakeGitLab();
		await remote.externalCommit({ 'old/name.md': 'content', 'other.md': 'x' });
		const d = makeDevice(remote);
		await synced(d);

		d.vault.remove('old/name.md');
		d.vault.set('new/name.md', 'content');
		d.vault.set('other.md', 'y');
		const before = remote.commits.length;
		await synced(d);

		expect(remote.commits.length).toBe(before + 1);
		expect(remote.files()).toEqual(map({ 'new/name.md': 'content', 'other.md': 'y' }));
	});

	it('preserves bytes exactly, including CRLF, BOM and binary data', async () => {
		const remote = new FakeGitLab();
		const d = makeDevice(remote);
		const crlf = new TextEncoder().encode('a\r\nb\r\n');
		const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x0a]);
		const binary = Uint8Array.from({ length: 2048 }, (_, i) => (i * 13) % 256);
		d.vault.set('crlf.md', crlf);
		d.vault.set('bom.md', bom);
		d.vault.set('image.bin', binary);
		await synced(d);

		const other = makeDevice(remote, { deviceId: 'device-2' });
		await synced(other);
		expect(other.vault.files.get('crlf.md')?.data).toEqual(crlf);
		expect(other.vault.files.get('bom.md')?.data).toEqual(bom);
		expect(other.vault.files.get('image.bin')?.data).toEqual(binary);
	});
});

describe('conflicts', () => {
	async function bothEdited() {
		const remote = new FakeGitLab();
		await remote.externalCommit({ 'plan.md': 'base' });
		const d = makeDevice(remote);
		await synced(d);
		d.vault.set('plan.md', 'mine');
		await remote.externalCommit({ 'plan.md': 'theirs' });
		return { remote, d };
	}

	it('leaves an unresolved conflict untouched on both sides', async () => {
		const { remote, d } = await bothEdited();
		const summary = await synced(d);
		expect(summary.conflicts).toBe(1);
		expect(d.vault.get('plan.md')).toBe('mine');
		expect(remote.files().get('plan.md')).toBe('theirs');
	});

	it('keep mine overwrites GitLab deliberately', async () => {
		const { remote, d } = await bothEdited();
		await synced(d, { 'plan.md': 'mine' });
		expect(remote.files().get('plan.md')).toBe('mine');
	});

	it('keep theirs replaces the vault copy and keeps the old one in the trash', async () => {
		const { d } = await bothEdited();
		await synced(d, { 'plan.md': 'theirs' });
		expect(d.vault.get('plan.md')).toBe('theirs');
		expect(d.vault.trashed.map(t => new TextDecoder().decode(t.data))).toEqual(['mine']);
	});

	it('keep both ends with both versions on both sides', async () => {
		const { remote, d } = await bothEdited();
		await synced(d, { 'plan.md': 'both' });
		const expected = map({ 'plan (GitLab 2026-10-04 1432).md': 'theirs', 'plan.md': 'mine' });
		expect(remote.files()).toEqual(expected);
		expect(d.vault.snapshot()).toEqual(expected);
	});

	it('does not delete a file on GitLab that another device edited after this one deleted it', async () => {
		const remote = new FakeGitLab();
		await remote.externalCommit({ 'note.md': 'v1' });
		const d = makeDevice(remote);
		await synced(d);
		d.vault.remove('note.md');
		await remote.externalCommit({ 'note.md': 'v2' });

		const summary = await synced(d);
		expect(summary.conflicts).toBe(1);
		expect(remote.files().get('note.md')).toBe('v2');
	});
});

describe('races and safety', () => {
	it('re-plans instead of overwriting when GitLab changes between review and commit', async () => {
		const remote = new FakeGitLab();
		await remote.externalCommit({ 'note.md': 'v1' });
		const d = makeDevice(remote);
		await synced(d);
		d.vault.set('note.md', 'mine');
		remote.beforeNextCommit = async () => { await remote.externalCommit({ 'note.md': 'theirs' }); };

		const summary = await synced(d);

		expect(summary.conflicts).toBe(1);
		expect(remote.files().get('note.md')).toBe('theirs');
		expect(d.vault.get('note.md')).toBe('mine');
	});

	it('skips a pull when the file was edited in the vault during the sync', async () => {
		const remote = new FakeGitLab();
		await remote.externalCommit({ 'note.md': 'v1' });
		const d = makeDevice(remote);
		await synced(d);
		await remote.externalCommit({ 'note.md': 'v2' });
		await d.engine.refresh();
		// The vault snapshot is now cached, so the next read is the pull's safety re-check.
		let armed = true;
		d.vault.beforeRead = path => {
			if (armed && path === 'note.md') {
				armed = false;
				d.vault.set('note.md', 'typed during sync');
			}
		};

		const summary = await synced(d);
		expect(summary.skipped).toBe(1);
		expect(d.vault.get('note.md')).toBe('typed during sync');
	});

	it('refuses to run two syncs at once', async () => {
		const remote = new FakeGitLab();
		const d = makeDevice(remote);
		d.vault.set('a.md', 'a');
		const first = d.engine.sync();
		await expect(d.engine.sync()).rejects.toThrow('already running');
		await first;
	});

	it('asks before deleting many files and changes nothing when declined', async () => {
		const remote = new FakeGitLab();
		const files: Record<string, string> = {};
		for (let i = 0; i < 12; i++) files[`n${i}.md`] = String(i);
		await remote.externalCommit(files);
		const d = makeDevice(remote);
		await synced(d);
		for (let i = 0; i < 12; i++) d.vault.remove(`n${i}.md`);

		let asked = 0;
		const summary = await d.engine.sync({ confirmDeletions: async () => { asked++; return false; } });

		expect(asked).toBe(1);
		expect(summary.cancelled).toBe(true);
		expect(remote.files().size).toBe(12);
	});

	it('never touches dot-folders such as .obsidian, on either side', async () => {
		const remote = new FakeGitLab();
		await remote.externalCommit({ '.obsidian/plugins/x/main.js': 'code', 'note.md': 'n' });
		const d = makeDevice(remote);
		d.vault.set('.obsidian/plugins/synclab/data.json', '{"token":"secret"}');
		d.vault.set('.trash/old.md', 'old');
		await synced(d);

		expect([...remote.files().keys()].sort()).toEqual(['.obsidian/plugins/x/main.js', 'note.md']);
		expect(d.vault.get('.obsidian/plugins/x/main.js')).toBeUndefined();
	});

	it('never deletes a file because it became ignored or too large', async () => {
		const remote = new FakeGitLab();
		await remote.externalCommit({ 'big.pdf': 'small for now', 'drafts/x.md': 'x' });
		const d = makeDevice(remote);
		await synced(d);

		d.vault.set('big.pdf', 'x'.repeat(2048));
		const strict = makeDevice(remote, { vault: d.vault, slots: d.slots, maxFileBytes: 1024, isIgnored: p => p.startsWith('drafts/') });
		d.vault.remove('drafts/x.md');
		const summary = await synced(strict);

		expect(summary.deleted).toBe(0);
		expect(remote.files()).toEqual(map({ 'big.pdf': 'small for now', 'drafts/x.md': 'x' }));
	});

	it('ignores sync state copied from another device', async () => {
		const remote = new FakeGitLab();
		await remote.externalCommit({ 'a.md': 'a' });
		const laptop = makeDevice(remote, { deviceId: 'laptop' });
		await synced(laptop);

		// The plugin folder (and its state) got copied to a phone whose vault never had a.md.
		const slots = new MemorySlots();
		for (const [slot, value] of laptop.slots.data) slots.data.set(slot, value);
		const phone = makeDevice(remote, { deviceId: 'phone', slots });
		const summary = await synced(phone);

		expect(summary.deleted).toBe(0);
		expect(remote.files().get('a.md')).toBe('a');
		expect(phone.vault.get('a.md')).toBe('a');
	});

	it('starts a fresh, safe history when pointed at a different project', async () => {
		const remote = new FakeGitLab();
		await remote.externalCommit({ 'README.md': 'old project' });
		const d = makeDevice(remote);
		await synced(d);
		d.vault.remove('README.md');

		const otherProject = new FakeGitLab();
		await otherProject.externalCommit({ 'README.md': 'new project' });
		const switched = makeDevice(otherProject, { vault: d.vault, slots: d.slots, targetKey: 'https://gitlab.example|2|main|' });
		const summary = await synced(switched);

		expect(summary.deleted).toBe(0);
		expect(otherProject.files().get('README.md')).toBe('new project');
		expect(d.vault.get('README.md')).toBe('new project');
	});
});

describe('two devices', () => {
	it('converges after each device syncs', async () => {
		const remote = new FakeGitLab();
		const laptop = makeDevice(remote, { deviceId: 'laptop' });
		const phone = makeDevice(remote, { deviceId: 'phone' });

		laptop.vault.set('daily.md', 'written on laptop');
		await synced(laptop);
		await synced(phone);
		phone.vault.set('daily.md', 'edited on phone');
		phone.vault.set('idea.md', 'new on phone');
		await synced(phone);
		await synced(laptop);

		expect(laptop.vault.snapshot()).toEqual(phone.vault.snapshot());
		expect(laptop.vault.snapshot()).toEqual(remote.files());
	});
});

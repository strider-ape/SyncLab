import { describe, expect, it } from 'vitest';
import { createIgnoreMatcher, isHardExcluded, normalizeFolder, toRepoPath, toVaultPath } from '../../src/core/paths';

describe('isHardExcluded', () => {
	it.each([
		'.obsidian/plugins/synclab/data.json',
		'.trash/old.md',
		'.git/config',
		'notes/.hidden.md',
		'.gitignore',
		'movies.sync-conflict-20251106-145621-DPDD3PL.md',
		'Daily/plan.sync-conflict-20260404-201849-OASEYZQ.md',
		'README.sync-conflict-20260404-201849-OASEYZQ',
		'~syncthing~note.md.tmp',
		'Daily/~syncthing~2026-10-04.md.tmp',
	])('skips %s', path => {
		expect(isHardExcluded(path)).toBe(true);
	});

	it.each([
		'note.md',
		'Daily/2026-10-04.md',
		'my sync-conflict notes.md',
		'about.sync-conflict.md',
		'~draft.md',
		'syncthing~tips.md',
	])('keeps %s', path => {
		expect(isHardExcluded(path)).toBe(false);
	});
});

describe('folder mapping', () => {
	it('normalizes user-entered folders', () => {
		expect(normalizeFolder(' /Notes/Work/ ')).toBe('Notes/Work');
		expect(normalizeFolder('Notes\\Work')).toBe('Notes/Work');
		expect(normalizeFolder('')).toBe('');
	});

	it('maps between vault and repository paths', () => {
		expect(toRepoPath('Notes/a.md', 'Notes')).toBe('a.md');
		expect(toRepoPath('Other/a.md', 'Notes')).toBeNull();
		expect(toRepoPath('NotesExtra/a.md', 'Notes')).toBeNull();
		expect(toRepoPath('a.md', '')).toBe('a.md');
		expect(toVaultPath('a.md', 'Notes')).toBe('Notes/a.md');
	});
});

describe('createIgnoreMatcher', () => {
	it('follows .gitignore rules', () => {
		const ignored = createIgnoreMatcher('drafts/\n*.tmp\n# comment\n!keep.tmp');
		expect(ignored('drafts/x.md')).toBe(true);
		expect(ignored('a.tmp')).toBe(true);
		expect(ignored('keep.tmp')).toBe(false);
		expect(ignored('notes/a.md')).toBe(false);
	});
});

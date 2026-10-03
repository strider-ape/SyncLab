import { describe, expect, it } from 'vitest';
import { buildPlan, computeChanges, conflictCopyPath, countDeletions } from '../../src/core/planner';
import type { Tree } from '../../src/core/types';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const tree = (entries: Record<string, string>): Tree => new Map(Object.entries(entries));
const NOW = new Date(2026, 9, 4, 14, 32);

describe('computeChanges', () => {
	it('records in-sync paths and lists every difference once', () => {
		const set = computeChanges(
			tree({ 'same.md': A, 'edited.md': A, 'gone.md': A }),
			tree({ 'same.md': A, 'edited.md': B, 'new.md': C }),
			tree({ 'same.md': A, 'edited.md': A, 'gone.md': A }),
		);
		expect(set.inSync).toEqual([{ path: 'same.md', blob: A }]);
		expect(set.changes.map(c => [c.path, c.decision])).toEqual([
			['edited.md', { kind: 'push', op: 'update' }],
			['gone.md', { kind: 'push', op: 'delete' }],
			['new.md', { kind: 'push', op: 'create' }],
		]);
	});

	it('flags paths that collide case-insensitively on one side and leaves them alone', () => {
		const set = computeChanges(tree({}), tree({ 'Note.md': A }), tree({ 'note.md': B, 'NOTE.md': C }));
		expect(set.attention.map(a => a.path)).toEqual(['NOTE.md', 'note.md']);
		expect(set.changes.map(c => c.path)).toEqual(['Note.md']);
	});

	it('records a path deleted on both sides as in sync without a blob', () => {
		const set = computeChanges(tree({ 'old.md': A }), tree({}), tree({}));
		expect(set.inSync).toEqual([{ path: 'old.md' }]);
	});
});

describe('buildPlan', () => {
	it('splits one-sided changes into pulls and pushes', () => {
		const set = computeChanges(
			tree({ 'up.md': A, 'down.md': A, 'gone-here.md': A }),
			tree({ 'up.md': B, 'down.md': A }),
			tree({ 'up.md': A, 'down.md': C, 'gone-here.md': A }),
		);
		const plan = buildPlan(set);
		expect(plan.push).toEqual([
			{ path: 'gone-here.md', op: 'delete', remoteBlob: A },
			{ path: 'up.md', op: 'update', localBlob: B, remoteBlob: A },
		]);
		expect(plan.pull).toEqual([{ path: 'down.md', op: 'update', remoteBlob: C, localBlob: A, backupLocal: false }]);
		expect(countDeletions(plan)).toBe(1);
	});

	it('leaves unchecked changes and unresolved conflicts untouched', () => {
		const set = computeChanges(tree({ 'x.md': A }), tree({ 'x.md': B, 'y.md': A }), tree({ 'x.md': C }));
		const plan = buildPlan(set, { excluded: new Set(['y.md']) });
		expect(plan.push).toEqual([]);
		expect(plan.pull).toEqual([]);
		expect(plan.skipped.map(c => c.path)).toEqual(['y.md']);
		expect(plan.conflicts.map(c => c.path)).toEqual(['x.md']);
	});

	it('keep mine overwrites GitLab only after checking it still has the reviewed version', () => {
		const set = computeChanges(tree({ 'x.md': A }), tree({ 'x.md': B }), tree({ 'x.md': C }));
		const plan = buildPlan(set, { resolutions: new Map([['x.md', 'mine']]) });
		expect(plan.push).toEqual([{ path: 'x.md', op: 'update', localBlob: B, remoteBlob: C }]);
		expect(plan.pull).toEqual([]);
	});

	it('keep theirs backs up the local file before replacing it', () => {
		const set = computeChanges(tree({ 'x.md': A }), tree({ 'x.md': B }), tree({ 'x.md': C }));
		const plan = buildPlan(set, { resolutions: new Map([['x.md', 'theirs']]) });
		expect(plan.pull).toEqual([{ path: 'x.md', op: 'update', remoteBlob: C, localBlob: B, backupLocal: true }]);
		expect(plan.push).toEqual([]);
	});

	it('keep both saves GitLab\'s version as a sibling copy and syncs both files', () => {
		const set = computeChanges(tree({ 'Projects/plan.md': A }), tree({ 'Projects/plan.md': B }), tree({ 'Projects/plan.md': C }));
		const plan = buildPlan(set, { resolutions: new Map([['Projects/plan.md', 'both']]), now: NOW });
		const copy = 'Projects/plan (GitLab 2026-10-04 1432).md';
		expect(plan.pull).toEqual([{ path: copy, op: 'create', remoteBlob: C, backupLocal: false }]);
		expect(plan.push).toEqual([
			{ path: 'Projects/plan.md', op: 'update', localBlob: B, remoteBlob: C },
			{ path: copy, op: 'create', localBlob: C },
		]);
	});

	it('keep both restores the surviving side when one side deleted the file', () => {
		const deletedHere = computeChanges(tree({ 'x.md': A }), tree({}), tree({ 'x.md': B }));
		expect(buildPlan(deletedHere, { resolutions: new Map([['x.md', 'both']]) }).pull)
			.toEqual([{ path: 'x.md', op: 'create', remoteBlob: B, backupLocal: false }]);

		const deletedThere = computeChanges(tree({ 'x.md': A }), tree({ 'x.md': B }), tree({}));
		expect(buildPlan(deletedThere, { resolutions: new Map([['x.md', 'both']]) }).push)
			.toEqual([{ path: 'x.md', op: 'create', localBlob: B }]);
	});

	it('orders local deletions before writes so case-only renames work', () => {
		const set = computeChanges(tree({ 'Note.md': A }), tree({ 'Note.md': A }), tree({ 'note.md': A }));
		expect(buildPlan(set).pull.map(p => [p.op, p.path])).toEqual([['delete', 'Note.md'], ['create', 'note.md']]);
	});
});

describe('conflictCopyPath', () => {
	it('keeps folder and extension and adds a timestamp', () => {
		expect(conflictCopyPath('a/b/c.md', NOW)).toBe('a/b/c (GitLab 2026-10-04 1432).md');
		expect(conflictCopyPath('README', NOW)).toBe('README (GitLab 2026-10-04 1432)');
	});

	it('avoids names that are already taken', () => {
		const taken = new Set(['c (gitlab 2026-10-04 1432).md']);
		expect(conflictCopyPath('c.md', NOW, taken)).toBe('c (GitLab 2026-10-04 1432 2).md');
	});
});

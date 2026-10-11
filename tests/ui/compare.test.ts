import { describe, expect, it } from 'vitest';
import type { Change } from '../../src/core/types';
import { compareView, decodeText, diffRows, type DiffRow } from '../../src/ui/compare';
import { bytes } from '../support/fakes';

const change = (decision: Change['decision']): Change => ({ path: 'Notes/plan.md', decision });

/** The rows Compare shows for a change, given each side's text (null when the file doesn't exist there). */
function shown(c: Change, local: string | null, remote: string | null): string[] {
	const view = compareView(c, { local: local === null ? null : bytes(local), remote: remote === null ? null : bytes(remote) });
	return describeRows(diffRows(decodeText(view.before.data) ?? '', decodeText(view.after.data) ?? ''));
}

function describeRows(rows: DiffRow[]): string[] {
	return rows.map(row => (row.kind === 'gap' ? `gap:${row.count}` : `${row.kind}:${row.text}`));
}

describe('Compare direction', () => {
	it('shows a line added on GitLab as an addition', () => {
		expect(shown(change({ kind: 'pull', op: 'update' }), 'one\n', 'one\ntwo\n')).toEqual(['same:one', 'add:two']);
	});

	it('shows a line removed on GitLab as a removal', () => {
		expect(shown(change({ kind: 'pull', op: 'update' }), 'one\ntwo\n', 'one\n')).toEqual(['same:one', 'del:two']);
	});

	it('shows a note new on GitLab as additions, and one deleted there as removals', () => {
		expect(shown(change({ kind: 'pull', op: 'create' }), null, 'hello\n')).toEqual(['add:hello']);
		expect(shown(change({ kind: 'pull', op: 'delete' }), 'bye\n', null)).toEqual(['del:bye']);
	});

	it('shows a line you added as an addition', () => {
		expect(shown(change({ kind: 'push', op: 'update' }), 'one\ntwo\n', 'one\n')).toEqual(['same:one', 'add:two']);
	});

	it('shows your new note as additions, and your deleted note as removals', () => {
		expect(shown(change({ kind: 'push', op: 'create' }), 'hello\n', null)).toEqual(['add:hello']);
		expect(shown(change({ kind: 'push', op: 'delete' }), null, 'bye\n')).toEqual(['del:bye']);
	});

	it('compares a conflict from GitLab\'s version to yours', () => {
		expect(shown(change({ kind: 'conflict', reason: 'both-changed' }), 'mine\n', 'theirs\n')).toEqual(['del:theirs', 'add:mine']);
	});
});

describe('Compare labels', () => {
	const content = { local: bytes('local'), remote: bytes('remote') };

	it('puts this vault first for incoming changes, and GitLab first otherwise', () => {
		const incoming = compareView(change({ kind: 'pull', op: 'update' }), content);
		expect([incoming.before.label, incoming.after.label]).toEqual(['This vault', 'GitLab']);
		expect(incoming.before.data).toBe(content.local);

		for (const decision of [{ kind: 'push', op: 'update' }, { kind: 'conflict', reason: 'both-changed' }] as const) {
			const view = compareView(change(decision), content);
			expect([view.before.label, view.after.label]).toEqual(['GitLab', 'This vault']);
			expect(view.before.data).toBe(content.remote);
		}
	});

	it('says which way the change goes, or why it conflicts', () => {
		expect(compareView(change({ kind: 'pull', op: 'update' }), content).subtitle).toBe('GitLab\'s change, coming to this vault');
		expect(compareView(change({ kind: 'push', op: 'create' }), content).subtitle).toBe('Your change, going to GitLab');
		expect(compareView(change({ kind: 'conflict', reason: 'deleted-here-changed-there' }), content).subtitle).toBe('Deleted here, changed on GitLab');
	});
});

describe('diffRows', () => {
	it('folds long unchanged runs, keeping three lines of context around a change', () => {
		const before = `${Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')}\n`;
		const after = before.replace('line 10\n', 'line ten\n');
		expect(describeRows(diffRows(before, after))).toEqual([
			'gap:7',
			'same:line 7', 'same:line 8', 'same:line 9',
			'del:line 10', 'add:line ten',
			'same:line 11', 'same:line 12', 'same:line 13',
			'gap:6',
		]);
	});

	it('has nothing to show for identical text', () => {
		expect(diffRows('a\nb\n', 'a\nb\n').every(row => row.kind === 'same' || row.kind === 'gap')).toBe(true);
	});
});

describe('decodeText', () => {
	it('tells text, binary and missing files apart', () => {
		expect(decodeText(bytes('héllo'))).toBe('héllo');
		expect(decodeText(new Uint8Array([0xff, 0xfe, 0x00]).buffer)).toBeUndefined();
		expect(decodeText(null)).toBeNull();
	});
});

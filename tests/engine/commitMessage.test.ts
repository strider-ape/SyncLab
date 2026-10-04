import { describe, expect, it } from 'vitest';
import { buildCommitMessage } from '../../src/engine/commitMessage';
import type { CommitAction } from '../../src/gitlab/GitLabClient';

const add = (path: string): CommitAction => ({ action: 'create', file_path: path, content: '', encoding: 'base64' });
const update = (path: string): CommitAction => ({ action: 'update', file_path: path, content: '', encoding: 'base64' });
const remove = (path: string): CommitAction => ({ action: 'delete', file_path: path });
const move = (from: string, to: string): CommitAction => ({ action: 'move', previous_path: from, file_path: to });

describe('automatic messages for one file', () => {
	it.each([
		[update('Daily/2026-10-04.md'), 'Update Daily/2026-10-04.md'],
		[add('Ideas/new.md'), 'Add Ideas/new.md'],
		[remove('Old/Scratch.md'), 'Delete Old/Scratch.md'],
		[move('Plan.md', 'Projects/Plan.md'), 'Move Plan.md to Projects/Plan.md'],
	])('names the file: %o', (action, expected) => {
		expect(buildCommitMessage([action])).toBe(expected);
	});

	it('calls a move within one folder a rename and lists the full new path', () => {
		expect(buildCommitMessage([move('Projects/Plan.md', 'Projects/Roadmap.md')])).toBe(
			'Rename Projects/Plan.md to Roadmap.md\n\nMoved:\n- Projects/Plan.md → Projects/Roadmap.md',
		);
	});

	it('falls back to the file name when the path is too long, and lists the full path', () => {
		const path = `${'Very long folder name/'.repeat(4)}note.md`;
		expect(buildCommitMessage([update(path)])).toBe(`Update note.md\n\nUpdated:\n- ${path}`);
	});
});

describe('automatic messages for several files', () => {
	it('names up to three files of the same kind and lists their full paths', () => {
		expect(buildCommitMessage([update('A/a.md'), update('B/b.md'), update('c.md')])).toBe(
			'Update a.md, b.md and c.md\n\nUpdated:\n- A/a.md\n- B/b.md\n- c.md',
		);
		expect(buildCommitMessage([remove('x.md'), remove('y.md')])).toBe('Delete x.md and y.md\n\nDeleted:\n- x.md\n- y.md');
	});

	it('summarises mixed changes with counts and lists every file by kind', () => {
		const message = buildCommitMessage([update('b.md'), remove('old.md'), add('new.md'), update('a.md'), move('x.md', 'y/x.md')]);
		expect(message).toBe([
			'Add 1 file, update 2 files, move 1 file, delete 1 file',
			'',
			'Added:\n- new.md',
			'',
			'Updated:\n- a.md\n- b.md',
			'',
			'Moved:\n- x.md → y/x.md',
			'',
			'Deleted:\n- old.md',
		].join('\n'));
	});

	it('summarises four or more files of one kind with a count', () => {
		const message = buildCommitMessage(['a', 'b', 'c', 'd'].map(n => update(`${n}.md`)));
		expect(message.split('\n')[0]).toBe('Update 4 files');
	});

	it('lists at most 100 files and says how many more there are', () => {
		const message = buildCommitMessage(Array.from({ length: 150 }, (_, i) => add(`n${String(i).padStart(3, '0')}.md`)));
		expect(message.split('\n').filter(line => line.startsWith('- '))).toHaveLength(100);
		expect(message).toContain('…and 50 more');
	});
});

describe('message details', () => {
	it('keeps a typed message as the title and lists the files below it', () => {
		expect(buildCommitMessage([update('a.md')], { message: '  Weekly review  ', deviceName: 'Laptop' })).toBe(
			'Weekly review\n\nUpdated:\n- a.md\n\nSynced with SyncLab from Laptop',
		);
	});

	it('marks each part when a sync is split into several commits', () => {
		const actions = ['a', 'b', 'c', 'd'].map(n => update(`${n}.md`));
		expect(buildCommitMessage(actions, { part: { index: 0, count: 2 } }).split('\n')[0]).toBe('Update 4 files (part 1 of 2)');
		expect(buildCommitMessage(actions, { message: 'Big import\nwith details', part: { index: 1, count: 2 } }).split('\n').slice(0, 2))
			.toEqual(['Big import (part 2 of 2)', 'with details']);
	});

	it('keeps every file on one line whatever its name contains', () => {
		const message = buildCommitMessage([update('odd\nname.md'), update('tab\there.md')]);
		expect(message).toContain('- odd name.md');
		expect(message).toContain('- tab here.md');
	});
});

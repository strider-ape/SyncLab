import type { CommitAction } from '../gitlab/GitLabClient';

/**
 * Builds a commit message from the exact actions sent to GitLab in that
 * commit, so it can never name a file the commit doesn't change, or miss one.
 * Messages are labels only: SyncLab never reads them back, and sync state is
 * tracked by file contents, never by commit messages.
 */

const SUBJECT_LIMIT = 72;
const LISTED_LIMIT = 100;

type Kind = 'add' | 'update' | 'move' | 'delete';
interface Change { kind: Kind; path: string; from?: string }

const VERB: Record<Kind, string> = { add: 'Add', update: 'Update', move: 'Move', delete: 'Delete' };
const HEADING: Record<Kind, string> = { add: 'Added', update: 'Updated', move: 'Moved', delete: 'Deleted' };
const ORDER: Kind[] = ['add', 'update', 'move', 'delete'];

export interface CommitMessageOptions {
	/** What the user typed, if anything. Used as-is at the top. */
	message?: string;
	deviceName?: string;
	/** Set when one sync is split into several commits. */
	part?: { index: number; count: number };
}

export function buildCommitMessage(actions: readonly CommitAction[], options: CommitMessageOptions = {}): string {
	const changes = actions.map(toChange);
	const custom = options.message?.trim() ?? '';

	let subject = custom || autoSubject(changes);
	if (options.part && options.part.count > 1) {
		const suffix = ` (part ${options.part.index + 1} of ${options.part.count})`;
		subject = custom ? subject.replace(/^[^\n]*/, line => line + suffix) : subject + suffix;
	}

	const sections: string[] = [subject];
	// A single change is already named in full in an automatic subject.
	if (custom || changes.length > 1 || !subject.includes(clean(changes[0]?.path ?? ''))) {
		sections.push(fileList(changes));
	}
	const device = clean(options.deviceName ?? '').trim();
	if (device) sections.push(`Synced with SyncLab from ${device}`);
	return sections.join('\n\n');
}

function toChange(action: CommitAction): Change {
	const kind: Kind = action.action === 'create' ? 'add' : action.action;
	return kind === 'move' ? { kind, path: action.file_path, from: action.previous_path } : { kind, path: action.file_path };
}

function autoSubject(changes: Change[]): string {
	if (changes.length === 0) return 'Sync';

	if (changes.length === 1) {
		const change = changes[0] as Change;
		for (const name of [describe(change, true), describe(change, false)]) {
			if (name.length <= SUBJECT_LIMIT) return name;
		}
	}

	const kinds = new Set(changes.map(change => change.kind));
	if (changes.length <= 3 && kinds.size === 1) {
		const kind = changes[0]?.kind as Kind;
		if (kind !== 'move') {
			const subject = `${VERB[kind]} ${joinNames(changes.map(change => basename(change.path)))}`;
			if (subject.length <= SUBJECT_LIMIT) return subject;
		}
	}

	const counts = ORDER.filter(kind => kinds.has(kind)).map(kind => {
		const n = changes.filter(change => change.kind === kind).length;
		return `${VERB[kind].toLowerCase()} ${n} file${n === 1 ? '' : 's'}`;
	});
	const joined = counts.join(', ');
	return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** One change in words, with full paths or just file names. */
function describe(change: Change, fullPaths: boolean): string {
	const name = (path: string) => (fullPaths ? clean(path) : basename(path));
	if (change.kind !== 'move' || change.from === undefined) return `${VERB[change.kind]} ${name(change.path)}`;
	if (dirname(change.from) === dirname(change.path)) return `Rename ${name(change.from)} to ${basename(change.path)}`;
	return `Move ${name(change.from)} to ${clean(change.path)}`;
}

function fileList(changes: Change[]): string {
	const lines: string[] = [];
	let listed = 0;
	for (const kind of ORDER) {
		const group = changes.filter(change => change.kind === kind).sort((a, b) => a.path.localeCompare(b.path));
		if (group.length === 0) continue;
		const room = LISTED_LIMIT - listed;
		if (room <= 0) break;
		if (lines.length) lines.push('');
		lines.push(`${HEADING[kind]}:`);
		for (const change of group.slice(0, room)) {
			lines.push(change.kind === 'move' && change.from !== undefined
				? `- ${clean(change.from)} → ${clean(change.path)}`
				: `- ${clean(change.path)}`);
		}
		listed += Math.min(group.length, room);
	}
	if (changes.length > listed) lines.push('', `…and ${changes.length - listed} more`);
	return lines.join('\n');
}

function joinNames(names: string[]): string {
	if (names.length <= 1) return names.join('');
	return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function basename(path: string): string {
	return clean(path.slice(path.lastIndexOf('/') + 1));
}

function dirname(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash === -1 ? '' : path.slice(0, slash);
}

/** Keeps every file on one line of the message, whatever its name contains. */
function clean(text: string): string {
	let out = '';
	for (const char of text) {
		const code = char.codePointAt(0) ?? 0;
		out += code < 32 || code === 127 ? ' ' : char;
	}
	return out;
}

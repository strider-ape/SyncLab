import { diffLines } from 'diff';
import type { Change } from '../core/types';
import { conflictReason } from './format';

/** One version of a file in Compare. */
export interface CompareSide {
	label: string;
	data: ArrayBuffer | null;
}

/** How Compare shows a change: lines go from `before` to `after`. */
export interface CompareView {
	subtitle: string;
	before: CompareSide;
	after: CompareSide;
}

export type DiffRow = { kind: 'add' | 'del' | 'same'; text: string } | { kind: 'gap'; count: number };

/** Unchanged lines kept around each change; longer runs collapse into a gap. */
const CONTEXT = 3;

/**
 * Shows each change the way Sync applies it: an incoming change reads as
 * what arrives in this vault, an outgoing one as what goes to GitLab.
 * A conflict compares GitLab's version with yours.
 */
export function compareView(change: Change, content: { local: ArrayBuffer | null; remote: ArrayBuffer | null }): CompareView {
	const gitlab: CompareSide = { label: 'GitLab', data: content.remote };
	const vault: CompareSide = { label: 'This vault', data: content.local };
	const { decision } = change;
	switch (decision.kind) {
		case 'pull': return { subtitle: 'GitLab\'s change, coming to this vault', before: vault, after: gitlab };
		case 'push': return { subtitle: 'Your change, going to GitLab', before: gitlab, after: vault };
		case 'conflict': return { subtitle: conflictReason(decision.reason), before: gitlab, after: vault };
	}
}

/** The file as UTF-8 text: null when there's no file, undefined when it isn't text. */
export function decodeText(data: ArrayBuffer | null): string | null | undefined {
	if (data === null) return null;
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(data);
	} catch {
		return undefined;
	}
}

/** Line-by-line differences from `before` to `after`, with long unchanged runs collapsed. */
export function diffRows(before: string, after: string): DiffRow[] {
	const lines: Array<{ kind: 'add' | 'del' | 'same'; text: string }> = [];
	for (const part of diffLines(before, after)) {
		const kind = part.added ? 'add' : part.removed ? 'del' : 'same';
		const text = part.value.endsWith('\n') ? part.value.slice(0, -1) : part.value;
		for (const line of text.split('\n')) lines.push({ kind, text: line });
	}

	// Keep a little context around each change and fold the rest.
	const rows: DiffRow[] = [];
	let start = 0;
	while (start < lines.length) {
		const same = lines[start]?.kind === 'same';
		let end = start;
		while (end < lines.length && (lines[end]?.kind === 'same') === same) end++;
		const run = lines.slice(start, end);
		const keepHead = start === 0 ? 0 : CONTEXT;
		const keepTail = end === lines.length ? 0 : CONTEXT;
		if (same && run.length > keepHead + keepTail + 1) {
			rows.push(...run.slice(0, keepHead), { kind: 'gap', count: run.length - keepHead - keepTail }, ...run.slice(run.length - keepTail));
		} else {
			rows.push(...run);
		}
		start = end;
	}
	return rows;
}

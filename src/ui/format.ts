import type { Change, ConflictReason } from '../core/types';

export function splitPath(path: string): { name: string; folder: string } {
	const slash = path.lastIndexOf('/');
	return slash === -1 ? { name: path, folder: '' } : { name: path.slice(slash + 1), folder: path.slice(0, slash) };
}

export function relativeTime(timestamp: number | undefined, now: number): string {
	if (!timestamp) return 'Not synced yet';
	const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
	if (seconds < 45) return 'Last synced just now';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `Last synced ${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `Last synced ${hours} h ago`;
	return `Last synced ${new Date(timestamp).toLocaleDateString()}`;
}

export function conflictReason(reason: ConflictReason): string {
	switch (reason) {
		case 'both-changed': return 'Changed here and on GitLab';
		case 'no-history': return 'Different here and on GitLab';
		case 'deleted-here-changed-there': return 'Deleted here, changed on GitLab';
		case 'changed-here-deleted-there': return 'Changed here, deleted on GitLab';
	}
}

export function badgeFor(change: Change): { letter: string; className: string; tag: string } {
	const { decision } = change;
	if (decision.kind === 'conflict') return { letter: '!', className: 'sl-b-conflict', tag: 'conflict' };
	const incoming = decision.kind === 'pull';
	switch (decision.op) {
		case 'create': return { letter: 'A', className: incoming ? 'sl-b-in' : 'sl-b-add', tag: 'new' };
		case 'update': return { letter: 'M', className: incoming ? 'sl-b-in' : 'sl-b-mod', tag: 'edited' };
		case 'delete': return { letter: 'D', className: incoming ? 'sl-b-in' : 'sl-b-del', tag: 'deleted' };
	}
}

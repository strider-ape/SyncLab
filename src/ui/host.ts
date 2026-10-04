import type { Change, RepoPath } from '../core/types';
import type { SyncEngine, SyncRequest, SyncSummary } from '../engine/SyncEngine';
import type { Store } from '../engine/store';

export interface HostInfo {
	configured: boolean;
	/** Set when settings exist but the token can't be found in secret storage. */
	missingToken: boolean;
	projectPath: string;
	branch: string;
	deviceName: string;
	/** Plugin version actually running, shown in the footer. */
	version: string;
}

/** Everything the sidebar needs from the plugin. */
export interface SidebarHost {
	engine: SyncEngine;
	info: Store<HostInfo>;
	sync(request: SyncRequest): Promise<SyncSummary>;
	refresh(): void;
	openDiff(change: Change): void;
	openFile(path: RepoPath): void;
	openSetup(): void;
	/** Opens the "Replace token" window. */
	replaceToken(): void;
	openSettings(): void;
	openOnGitLab(): void;
}

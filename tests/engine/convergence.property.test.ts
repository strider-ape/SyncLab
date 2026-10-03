import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Resolution } from '../../src/core/types';
import { FakeGitLab, makeDevice, text, type Device } from '../support/fakes';

/**
 * Random histories on two devices plus outside edits on GitLab. Whatever
 * happens, once both devices have synced a few times they must hold exactly
 * what GitLab holds, one more sync must change nothing at all, and every
 * version a device held when it synced must still be recoverable: on GitLab
 * (including history), in a vault, or in a trash.
 */

const PATHS = ['a.md', 'b.md', 'notes/c.md', 'img/d.bin'];
const CONTENTS = ['', 'one', 'two', 'three\r\n', 'ï»¿# bom'];

type Command =
	| { type: 'edit'; device: 0 | 1; path: string; content: string }
	| { type: 'delete'; device: 0 | 1; path: string }
	| { type: 'remote-edit'; path: string; content: string | null }
	| { type: 'sync'; device: 0 | 1; resolution: Resolution };

const device = fc.constantFrom(0 as const, 1 as const);
const path = fc.constantFrom(...PATHS);
const content = fc.constantFrom(...CONTENTS);
const command: fc.Arbitrary<Command> = fc.oneof(
	fc.record({ type: fc.constant('edit' as const), device, path, content }),
	fc.record({ type: fc.constant('delete' as const), device, path }),
	fc.record({ type: fc.constant('remote-edit' as const), path, content: fc.option(content, { nil: null }) }),
	fc.record({ type: fc.constant('sync' as const), device, resolution: fc.constantFrom<Resolution>('mine', 'theirs', 'both') }),
);

async function sync(d: Device, resolution: Resolution): Promise<void> {
	// Resolve every conflict the same way, whatever path it is on.
	const resolutions = new Map<string, Resolution>();
	const s = d.engine.state.get();
	for (const change of s.changes) resolutions.set(change.path, resolution);
	const summary = await d.engine.sync({ resolutions, confirmDeletions: async () => true });
	expect(summary.error).toBeUndefined();
}

async function syncResolvingEverything(d: Device, resolution: Resolution, mustSurvive: Set<string>): Promise<void> {
	for (const value of d.vault.snapshot().values()) if (value !== undefined) mustSurvive.add(value);
	await d.engine.refresh();
	await sync(d, resolution);
}

describe('two devices and GitLab', () => {
	it('always converge, and a repeated sync is a no-op', async () => {
		await fc.assert(
			fc.asyncProperty(fc.array(command, { maxLength: 25 }), fc.constantFrom<Resolution>('mine', 'theirs', 'both'), async (commands, finalResolution) => {
				const remote = new FakeGitLab();
				const devices = [makeDevice(remote, { deviceId: 'laptop' }), makeDevice(remote, { deviceId: 'phone' })] as const;
				const mustSurvive = new Set<string>();
				let counter = 0;
				// Every edit writes a unique version so a lost one can be detected.
				const unique = (value: string) => `${value}#${++counter}`;

				for (const c of commands) {
					if (c.type === 'edit') devices[c.device].vault.set(c.path, unique(c.content));
					else if (c.type === 'delete') devices[c.device].vault.remove(c.path);
					else if (c.type === 'remote-edit') {
						const exists = remote.files().has(c.path);
						if (c.content !== null || exists) await remote.externalCommit({ [c.path]: c.content === null ? null : unique(c.content) });
					} else await syncResolvingEverything(devices[c.device], c.resolution, mustSurvive);
				}

				// Settle: alternate syncs until both devices have seen each other's changes.
				for (let round = 0; round < 3; round++) {
					await syncResolvingEverything(devices[0], finalResolution, mustSurvive);
					await syncResolvingEverything(devices[1], finalResolution, mustSurvive);
				}

				const remoteFiles = remote.files();
				expect(devices[0].vault.snapshot()).toEqual(remoteFiles);
				expect(devices[1].vault.snapshot()).toEqual(remoteFiles);

				// No silent loss.
				const recoverable = new Set<string | undefined>([
					...[...remote.blobs.values()].map(b => text(b)),
					...devices.flatMap(d => d.vault.trashed.map(t => text(t.data))),
					...devices.flatMap(d => [...d.vault.snapshot().values()]),
				]);
				for (const version of mustSurvive) expect(recoverable.has(version), `lost "${version}"`).toBe(true);

				// Idempotency: nothing left to do on either device.
				const commits = remote.commits.length;
				const writes = devices.map(d => d.vault.writes);
				for (const d of devices) await syncResolvingEverything(d, finalResolution, new Set());
				expect(remote.commits.length).toBe(commits);
				expect(devices.map(d => d.vault.writes)).toEqual(writes);
			}),
			{ numRuns: 300 },
		);
	}, 120_000);
});

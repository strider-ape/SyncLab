import { describe, expect, it } from 'vitest';
import { classify } from '../../src/core/classify';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const _ = undefined;

describe('classify', () => {
	it.each([
		// base, local, remote, expected
		['identical everywhere', A, A, A, { kind: 'in-sync' }],
		['identical without history', _, A, A, { kind: 'in-sync' }],
		['deleted on both sides', A, _, _, { kind: 'in-sync' }],
		['changed identically on both sides', A, B, B, { kind: 'in-sync' }],
		['new local file', _, A, _, { kind: 'push', op: 'create' }],
		['new remote file', _, _, A, { kind: 'pull', op: 'create' }],
		['edited locally', A, B, A, { kind: 'push', op: 'update' }],
		['deleted locally', A, _, A, { kind: 'push', op: 'delete' }],
		['edited remotely', A, A, B, { kind: 'pull', op: 'update' }],
		['deleted remotely', A, A, _, { kind: 'pull', op: 'delete' }],
		['both sides differ with no history', _, A, B, { kind: 'conflict', reason: 'no-history' }],
		['edited on both sides', A, B, C, { kind: 'conflict', reason: 'both-changed' }],
		['deleted here, edited there', A, _, B, { kind: 'conflict', reason: 'deleted-here-changed-there' }],
		['edited here, deleted there', A, B, _, { kind: 'conflict', reason: 'changed-here-deleted-there' }],
	] as const)('%s', (_name, base, local, remote, expected) => {
		expect(classify(base, local, remote)).toEqual(expected);
	});

	it('never overwrites when there is no history', () => {
		for (const [l, r] of [[A, B], [B, A]] as const) {
			expect(classify(undefined, l, r).kind).toBe('conflict');
		}
	});

	it('never deletes anything without history', () => {
		const ids = [undefined, A, B];
		for (const l of ids) {
			for (const r of ids) {
				const decision = classify(undefined, l, r);
				expect(decision.kind !== 'in-sync' && 'op' in decision && decision.op === 'delete').toBe(false);
			}
		}
	});
});

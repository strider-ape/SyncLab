import type { StatePersistence, StoredState } from './ports';

/** Two small text files, written alternately. */
export interface StateSlots {
	read(slot: 'a' | 'b'): Promise<string | null>;
	write(slot: 'a' | 'b', text: string): Promise<void>;
}

interface Envelope {
	generation: number;
	checksum: string;
	state: StoredState;
}

/**
 * Crash-safe state persistence. Each save goes to the slot not holding the
 * newest copy, with a generation number and checksum. A save torn by a crash
 * leaves the previous slot intact, and loading picks the newest valid copy.
 */
export class StateStore implements StatePersistence {
	private generation = 0;

	constructor(private readonly slots: StateSlots) {}

	async load(): Promise<StoredState | null> {
		const envelopes = (await Promise.all([this.readSlot('a'), this.readSlot('b')]))
			.filter((e): e is Envelope => e !== null)
			.sort((x, y) => y.generation - x.generation);
		const newest = envelopes[0];
		if (!newest) return null;
		this.generation = newest.generation;
		return newest.state;
	}

	async save(state: StoredState): Promise<void> {
		this.generation += 1;
		const body = JSON.stringify(state);
		const envelope: Envelope = { generation: this.generation, checksum: fnv1a(body), state };
		await this.slots.write(this.generation % 2 === 0 ? 'a' : 'b', JSON.stringify(envelope));
	}

	private async readSlot(slot: 'a' | 'b'): Promise<Envelope | null> {
		try {
			const text = await this.slots.read(slot);
			if (!text) return null;
			const envelope = JSON.parse(text) as Envelope;
			if (typeof envelope.generation !== 'number' || envelope.state?.version !== 1) return null;
			return fnv1a(JSON.stringify(envelope.state)) === envelope.checksum ? envelope : null;
		} catch {
			return null;
		}
	}
}

/** FNV-1a 32-bit hash, hex. Detects torn or hand-edited state files. */
export function fnv1a(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

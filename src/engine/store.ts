/** Minimal observable value that satisfies Svelte's store contract. */
export class Store<T> {
	private readonly listeners = new Set<(value: T) => void>();

	constructor(private value: T) {}

	get(): T {
		return this.value;
	}

	set(value: T): void {
		this.value = value;
		for (const listener of this.listeners) listener(value);
	}

	update(fn: (value: T) => T): void {
		this.set(fn(this.value));
	}

	subscribe(listener: (value: T) => void): () => void {
		this.listeners.add(listener);
		listener(this.value);
		return () => this.listeners.delete(listener);
	}
}

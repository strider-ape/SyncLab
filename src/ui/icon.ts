import { setIcon } from 'obsidian';

/** Svelte action that renders one of Obsidian's built-in (Lucide) icons. */
export function icon(node: HTMLElement, name: string): { update(next: string): void } {
	setIcon(node, name);
	return {
		update(next: string) {
			node.empty();
			setIcon(node, next);
		},
	};
}

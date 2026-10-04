import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Readability guard for both themes. Parses the colour tokens from the
 * stylesheet and checks every pairing the UI uses against WCAG contrast:
 * 7:1 for body text, 4.5:1 for other text, 3:1 for outlines and states.
 */

const css = readFileSync('src/styles/synclab.css', 'utf8');

function tokens(selector: string): Record<string, string> {
	const start = css.indexOf(`${selector} {`);
	if (start === -1) throw new Error(`No ${selector} block`);
	const body = css.slice(start, css.indexOf('\n}', start));
	const out: Record<string, string> = {};
	for (const match of body.matchAll(/--sl-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[match[1] as string] = match[2] as string;
	return out;
}

const light = tokens('.synclab');
const themes = { light, dark: { ...light, ...tokens('.theme-dark .synclab') } };

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map(i => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
}

const FILLS = ['yellow', 'pink', 'green', 'blue', 'violet', 'orange', 'red'];

// [foreground token, background token, minimum ratio, what it is]
const PAIRS: Array<[string, string, number, string]> = [
	['text', 'bg', 7, 'body text on the panel'],
	['text', 'card', 7, 'body text on cards'],
	['text', 'field', 7, 'text in inputs and rows'],
	['muted', 'bg', 4.5, 'secondary text on the panel'],
	['muted', 'card', 4.5, 'secondary text on cards'],
	['muted', 'field', 4.5, 'secondary text in rows'],
	...FILLS.map((fill): [string, string, number, string] => ['on-fill', fill, 4.5, `text on ${fill}`]),
	['chip-text', 'chip-bg', 7, 'pills on coloured headers'],
	['selected-text', 'selected-bg', 4.5, 'a selected choice'],
	['log-text', 'log', 4.5, 'activity log text'],
	['log-time', 'log', 4.5, 'activity log times'],
	...['ok', 'up', 'down', 'warn', 'error'].map((kind): [string, string, number, string] => [`log-${kind}`, 'log', 4.5, `activity log "${kind}" lines`]),
	['ink', 'bg', 3, 'outlines on the panel'],
	['ink', 'card', 3, 'outlines on cards'],
	['ink', 'field', 3, 'outlines of rows and inputs'],
	...FILLS.map((fill): [string, string, number, string] => ['fill-ink', fill, 3, `outline of ${fill} fills`]),
	['check-mark', 'check-on', 3, 'tick inside a ticked box'],
	['check-on', 'field', 3, 'ticked box against its row'],
	['focus', 'bg', 3, 'keyboard focus ring on the panel'],
	['focus', 'card', 3, 'keyboard focus ring on cards'],
];

describe.each(Object.entries(themes))('%s theme', (_name, theme) => {
	it('defines every colour the checks need', () => {
		const needed = new Set(PAIRS.flatMap(([fg, bg]) => [fg, bg]));
		expect([...needed].filter(token => !theme[token])).toEqual([]);
	});

	it.each(PAIRS)('%s on %s ≥ %s:1 (%s)', (fg, bg, minimum) => {
		const ratio = contrast(theme[fg] as string, theme[bg] as string);
		expect(Math.round(ratio * 100) / 100, `${theme[fg]} on ${theme[bg]}`).toBeGreaterThanOrEqual(minimum);
	});
});

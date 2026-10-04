import { readFileSync, watch, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { IN_STYLES_CSS, noticeComment } from './third-party-notices.mjs';

const require = createRequire(import.meta.url);
const SOURCE = 'src/styles/synclab.css';
const OUTPUT = 'styles.css';
const FONT = require.resolve('@fontsource-variable/lexend/files/lexend-latin-wght-normal.woff2');
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

/**
 * Writes styles.css: the Lexend variable font (SIL Open Font License) embedded
 * as a data URI, so the plugin never fetches anything to render, followed by
 * SyncLab's styles.
 */
export async function buildCss() {
	const font = readFileSync(FONT).toString('base64');
	const fontFace = `${noticeComment(IN_STYLES_CSS)}
@font-face {
	font-family: "SyncLab Lexend";
	font-style: normal;
	font-display: swap;
	font-weight: 100 900;
	src: url(data:font/woff2;base64,${font}) format("woff2");
	unicode-range: ${LATIN};
}
`;
	writeFileSync(OUTPUT, fontFace + '\n' + readFileSync(SOURCE, 'utf8'));
}

export function watchCss() {
	watch(SOURCE, () => {
		void buildCss();
	});
}

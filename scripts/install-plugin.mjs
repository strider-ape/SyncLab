import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Copies the built plugin into a vault:
//   npm run build && npm run install-plugin -- "C:\path\to\vault"
// Refuses vaults managed by Syncthing (they contain .stfolder) unless --force is given,
// because two sync tools on one vault fight each other.

const args = process.argv.slice(2);
const force = args.includes('--force');
const vault = args.find(arg => arg !== '--force');
const fail = message => {
	process.stderr.write(`${message}\n`);
	process.exit(1);
};

if (!vault) fail('Usage: npm run install-plugin -- "<path to vault>" [--force]');
const root = resolve(vault);
if (!existsSync(join(root, '.obsidian'))) fail(`${root} doesn't look like an Obsidian vault (no .obsidian folder).`);

let dir = root;
while (dir !== dirname(dir)) {
	if (existsSync(join(dir, '.stfolder')) && !force) {
		fail(`${root} is inside a Syncthing folder (${dir}). Use a separate test vault, or pass --force if you're sure.`);
	}
	dir = dirname(dir);
}

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
	if (!existsSync(file)) fail(`${file} is missing. Run "npm run build" first.`);
}

const target = join(root, '.obsidian', 'plugins', 'synclab');
mkdirSync(target, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(file, join(target, file));
process.stdout.write(`Installed SyncLab into ${target}\nIn Obsidian, reload the plugin (or the app) to pick up the new build.\n`);

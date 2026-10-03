import { readFileSync, writeFileSync } from 'node:fs';

// `npm version patch|minor|major` runs this to keep manifest.json and versions.json in step.
const version = process.env.npm_package_version;
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = version;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t') + '\n');

const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[version] = manifest.minAppVersion;
writeFileSync('versions.json', JSON.stringify(versions, null, '\t') + '\n');

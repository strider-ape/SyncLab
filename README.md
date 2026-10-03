# SyncLab

**Review your changes and sync your Obsidian vault with a GitLab repository in one press.**

SyncLab does one job: keep a vault (or one folder of it) and one GitLab branch identical, without ever losing a note. It talks to GitLab's API directly, so there's no git to install and it works on desktop and mobile.

## How it works

1. **Review.** The SyncLab sidebar lists what changed in your vault and what changed on GitLab, like a source control panel. Click a file to compare versions; untick anything you don't want in this sync.
2. **Sync.** Press the big button. SyncLab pulls GitLab's changes, then pushes yours as a single commit, with your message or a generated one.
3. **Decide conflicts.** If a note changed in both places, SyncLab never guesses. You pick **Mine**, **Theirs** (yours goes to the trash) or **Both** (GitLab's copy is saved next to yours).

## What SyncLab promises

- **Nothing is silently overwritten.** Files that changed on both sides, or that differ on a first sync, become conflicts for you to decide.
- **Syncing twice changes nothing the second time.** If a sync is interrupted (closed app, lost connection), pressing Sync again finishes the job without duplicates.
- **If GitLab changes while you sync**, the commit is refused and SyncLab re-checks instead of overwriting someone's work.
- **Deleted files go to the trash**, following Obsidian's "Deleted files" setting. Large batches of deletions ask first.
- **Your files are copied byte for byte.** Images, PDFs and other binaries are never re-encoded.
- **Your `.obsidian` folder and other dot-folders are never synced**, so your settings and tokens stay on your device.

## Setup

Open SyncLab from the ribbon and choose **Connect GitLab**. The setup asks for:

1. Where your GitLab is: GitLab.com, or your own server's address.
2. A **personal access token with the `api` scope**. SyncLab opens GitLab's token page with this filled in. (`write_repository` alone doesn't work: GitLab doesn't accept it for API calls.) If your GitLab plan offers project access tokens, one scoped to a single project is even better.
3. The project and branch to sync with, picked from a list, or a new private project.
4. Whether to sync the whole vault or one folder.

The token is stored in Obsidian's secure keychain on this device (Obsidian 1.11.4 or later), never in your vault or in the plugin's settings file.

## Network use and privacy

SyncLab needs a GitLab account and connects **only to the GitLab server you configure**. It sends requests there to list, read and write files in the project and branch you chose. It has no telemetry, no analytics and no other network requests. The font it uses is bundled with the plugin.

## Install

Until SyncLab is in the community directory, install it with the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, or manually:

1. Download `main.js`, `manifest.json` and `styles.css` from the latest release.
2. Copy them into `<your vault>/.obsidian/plugins/synclab/`.
3. Reload Obsidian and turn SyncLab on under **Settings → Community plugins**.

## Development

```bash
npm install
npm run dev            # watch build into main.js and styles.css
npm run build          # type checks + production build
npm test               # unit, engine and property-based tests
npm run lint           # ESLint with Obsidian's plugin rules
npm run preview        # builds a browser preview of the sidebar into dev/preview
npm run test:contract  # opt-in checks against a real GitLab project (see the test file)
```

The design and the reasoning behind it are in [docs/PLAN.md](docs/PLAN.md).

## License

MIT. SyncLab bundles the [Lexend](https://www.lexend.com/) typeface under the SIL Open Font License 1.1.

# SyncLab — Project Plan

> A GitLab sync plugin for Obsidian that does one job and does it perfectly:
> **review what changed, press Sync, and your vault and your GitLab repo match.**

Status: v0.1.2 released, tested on desktop and mobile · Last fact-checked: 2026-10-04

## 0. Where things stand (2026-10-04)

**Built.**
- Sync core, sync engine and GitLab client.
- Sidebar, setup wizard, diff view, token window and settings (declarative on Obsidian 1.13+).
- CI and tag-based release workflows. Releases 0.1.0, 0.1.1 and 0.1.2 are on GitHub.

**Verified.**
- `npx eslint .`: 0 errors, 0 warnings.
- `npm run build`: passes (type checks + Svelte checks + bundle).
- `npx vitest run`: 170 tests pass. They include:
  - a property test where random two-device histories must converge, repeat as a no-op, lose nothing, and get commit messages that list exactly the files changed;
  - WCAG contrast checks for both themes.

  Deliberately broken versions of the safety checks were confirmed to fail these tests.
- `npm run test:contract` against gitlab.com: 8/8 pass. Confirmed on real GitLab:
  - stale `last_commit_id` updates and deletes are rejected;
  - `create` of an existing file is rejected;
  - blob ids equal git blob ids for CRLF, BOM, binary and non-ASCII names;
  - downloads are byte-exact;
  - HEAD returns blob and last-commit ids;
  - `move` works without content;
  - keyset tree pagination works past 100 entries.
- Used in Obsidian 1.13.7 on Windows and on a phone:
  - first sync, including pulling an existing project into an empty vault;
  - edits, deletes and two-device round trips;
  - the token and settings screens.

**Not yet verified.**
- Very large vaults (thousands of files) and slow mobile networks.
- iOS, if only Android was tested.

**Built differently from the plan.**
- **Deletes follow Obsidian's "Deleted files" setting.** They use `fileManager.trashFile`, because Obsidian's lint rules forbid bypassing it. With Obsidian's defaults that means the trash; a user who chose "permanently delete" gets that.
- **A delete plus a create of the same content become one `move`** in the commit.

---

## 1. Principles

1. **One job.** Two-way sync between a vault (or one folder of it) and one GitLab branch. No multi-provider, no branch management, no merge tooling.
2. **Never lose data.** Nothing is overwritten without a known-safe reason. When in doubt, it's a conflict and the user decides. Local deletions follow Obsidian's "Deleted files" setting (the trash by default).
3. **Idempotent by construction.** Pressing Sync twice in a row does nothing the second time. A sync interrupted at any point (crash, network loss, app closed) is fixed by pressing Sync again. Nothing is duplicated or lost.
4. **Friendly.** Setup is a guided wizard that validates each step live. No project IDs to hunt for, no jargon.
5. **Small and boring inside, bold outside.** A tiny, well-tested core with a neo-brutalist UI on top.

## 2. Scope

**In v1**
- Right-sidebar **Source Control** panel (VS Code style): local changes, incoming changes, conflicts.
- Include/exclude individual changes (checkbox per file, all checked by default).
- Optional commit message; an automatic one is generated if left empty.
- One big **Sync** button: pull incoming, push local, all in one action.
- Diff view per file (local vs last-synced / remote).
- Conflict cards: **Keep mine / Keep theirs / Keep both**.
- Onboarding wizard: GitLab URL → token → pick project → pick branch → pick folder → first sync.
- Status bar badge, ribbon icon, commands: *Sync now*, *Open SyncLab*, *Refresh changes*.
- Desktop **and** mobile (no git binary needed).

**Not in v1 (on purpose)**
- GitHub/Gitea/Bitbucket, multiple repos, branch switching UI, merge requests.
- Automatic three-way text merging (conflicts are explicit).
- Syncing `.obsidian/` or any dot-folder; symlinks; Git LFS.
- Auto-sync timers (candidate for v1.1, off by default).

## 3. User experience

### 3.1 Onboarding wizard (first run)

| Step | What the user sees | Live validation |
|---|---|---|
| 1. Where is your GitLab? | `gitlab.com` (default) or "self-hosted" + URL | HTTPS check, `GET /api/v4/version` reachability |
| 2. Connect | "Create token" button opens GitLab's token page **pre-filled** (`name=SyncLab`, `scopes=api`), paste field | `GET /user` → shows avatar + "Connected as @name" |
| 3. Pick a project | Searchable list of your projects, plus "Create a new private project" | `permissions` ≥ Developer, else explains why it can't push |
| 4. Pick a branch | Dropdown, default branch preselected | Warns if branch is protected against your role |
| 5. What to sync | Whole vault or a folder; preview: "312 notes, 18 attachments, 4.1 MB" | Ignore rules shown, `.obsidian/` always excluded |
| 6. First sync | Plain-language summary of what will happen | Nothing is deleted on a first sync. Files that differ become conflicts |

The token scope must be `api`. GitLab's `write_repository` scope "Does not support API authentication". If the user's GitLab plan offers **project access tokens**, the wizard recommends one, because it limits the token to a single project.

### 3.2 Sidebar layout

```
┌──────────────────────────────────────┐
│ ▣ SYNCLAB              ⟳   ⋯         │  header: refresh, menu (open on GitLab, settings)
│ notes-vault  ⎇ main   ● 3 changes    │  project · branch chip · status pill
├──────────────────────────────────────┤
│ ┌──────────────────────────────────┐ │
│ │ Message (optional)…              │ │  commit message
│ └──────────────────────────────────┘ │
│ ╔══════════════════════════════════╗ │
│ ║        SYNC   ↑3  ↓1             ║ │  THE button (hard shadow, presses down)
│ ╚══════════════════════════════════╝ │
├──────────────────────────────────────┤
│ ⚠ CONFLICTS (1)                      │
│  ! Projects/plan.md   [Mine][Theirs][Both]
│ ▾ LOCAL CHANGES (3)          ☑ all   │
│  ☑ M  Daily/2026-10-04.md            │
│  ☑ A  Ideas/synclab.md               │
│  ☑ D  Old/scratch.md                 │
│ ▾ INCOMING (1)                       │
│  ☑ ↓  Projects/roadmap.md            │
├──────────────────────────────────────┤
│ Last synced 2 min ago · laptop       │
└──────────────────────────────────────┘
```

Click a row to open its diff. Right-click a row for *Open file*, *Discard local change* (goes to trash, asks first) and *Open on GitLab*.

### 3.3 The Sync button states

`Idle: SYNC ↑3 ↓1` → `Checking…` → `Syncing 4/12` (progress fill) → `Synced ✓` (brief success flash) / `Needs you: 1 conflict` / `Offline: retry`. The button is disabled while a sync runs, so a double-click can't start a second one.

### 3.4 Neo-brutalism that respects Obsidian themes

- **Look (approved 2026-10-04, after the user's reference):**
  - a cream dot-grid panel;
  - 3 px ink borders with rounded corners (16 px cards, 11 px controls) and hard offset shadows (`6px 6px 0`);
  - cards with a coloured header band;
  - a tilted yellow "LAB" wordmark block and tilted status pills;
  - a dark activity log.
- **Type:** Lexend (variable, SIL OFL), bundled into `styles.css` as a data URI so nothing is fetched at runtime. Headings and labels use heavy weights; status letters are monospace.
- **Light and dark:** SyncLab owns its palette inside its own panels. With `.theme-dark` it switches to warm charcoal surfaces with mid-grey outlines, black hard shadows, slightly toned fills, and near-black outlines on coloured fills, so text stays the brightest thing on screen. `tests/ui/contrast.test.ts` checks every colour pairing in both themes against WCAG contrast (7:1 body text, 4.5:1 other text, 3:1 outlines and states).
- **Status colours** are saturated flat fills, defined once as `--sl-*` tokens with a dark-mode set:

  | Status | Colour |
  |---|---|
  | Sync | yellow |
  | Added | mint |
  | Modified | blue |
  | Deleted | coral |
  | Conflict | orange |
  | Incoming | violet |

- **Motion:** buttons physically "press" on click (translate + shadow shrink). All motion is off under `prefers-reduced-motion`.
- **No hard-coded inline styles:** CSS classes only, per Obsidian's plugin guidelines.

## 4. Recommended tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript 5.9 (strict)**; 7.x isn't supported by typescript-eslint or svelte-check yet | Obsidian's API is typed; the sync state machine benefits most from types |
| Platform | **Obsidian API, `minAppVersion` 1.11.4** | Needed for `SecretStorage` (token kept out of the vault) |
| UI | **Svelte 5** mounted in an `ItemView` / `Modal` | Reactive file list and wizard with a tiny compiled runtime; scoped CSS suits the custom design; Obsidian's docs include a Svelte guide |
| Styling | Plain CSS → `styles.css`, Obsidian CSS variables + `--sl-*` tokens | Theme-compatible, no CSS framework needed |
| Build | **esbuild** + `esbuild-svelte` | Same bundler as Obsidian's official sample plugin; sub-second builds |
| Transport | **GitLab REST API v4** via Obsidian `requestUrl` | No git binary, works on mobile, no CORS issues, atomic multi-file commits |
| Hashing | Web Crypto SHA-1 in **git blob format** | Our local hash equals GitLab's blob id, so we compare without downloading |
| Ignore rules | `ignore` (npm) | Exact `.gitignore` semantics |
| Diff view | `diff` (jsdiff) | Small, proven line diff |
| Unit tests | **Vitest** + jsdom + an in-memory **FakeGitLab** and **FakeVault** | Fast and deterministic |
| Idempotency proof | **fast-check** property-based tests | Random edit histories on 2 simulated devices must always converge, and a second Sync must be a no-op |
| Contract tests | Opt-in suite against a real GitLab test project | Locks in the API behaviours we rely on |
| Lint | ESLint 9 + typescript-eslint + **eslint-plugin-obsidianmd** | Same rule family as Obsidian's automated review |
| CI / release | GitHub Actions: lint + test + build on PRs; tag → release with `main.js`, `manifest.json`, `styles.css` | Obsidian installs plugins from GitHub releases |
| Package manager | npm | Already installed, nothing extra to learn |

**Runtime dependencies:** `svelte`, `ignore` and `diff`, and nothing else.

## 5. Alternatives considered

### UI layer
| Option | Verdict |
|---|---|
| **Svelte 5** | ✅ Recommended. Reactive and small, with good Obsidian precedent |
| Vanilla TS + Obsidian `createEl` | Solid fallback with zero dependencies, but manual DOM updates are where the reference fork grew re-render bugs |
| Preact | Fine (~4 KB, React model). Choose this if you prefer JSX |
| React 19 | Works (Obsidian documents it), but ~45 KB is heavy for one sidebar |
| SolidJS | Excellent performance; smaller ecosystem among Obsidian plugins |
| Lit / web components | Shadow DOM fights Obsidian theming |

### Sync transport
| Option | Verdict |
|---|---|
| **GitLab REST API** | ✅ Recommended. Mobile-ready, atomic multi-file commits, per-file optimistic locking (`last_commit_id`) |
| GitLab GraphQL (`commitCreate`) | Same power with fewer round-trips for reads, but harder to debug. A later optimisation, not a foundation |
| isomorphic-git (real git in JS) | Full history and merges, but a large bundle, a `.git` folder inside the vault, slow clones on phones, and needs a custom HTTP adapter |
| System git (`simple-git`, like obsidian-git desktop) | Simplest on desktop, but needs git installed and rules out mobile |

### Where sync state lives
| Option | Verdict |
|---|---|
| **Own `state.json` in the plugin folder, crash-safe writes, stamped with target + device** | ✅ Recommended. Separate from settings, inspectable, recoverable |
| Inside `data.json` with settings (the reference fork) | ❌ Every file sync rewrote settings and tokens; concurrent writes |
| IndexedDB | Per-device by nature, but opaque and harder to debug |

### Token storage
| Option | Verdict |
|---|---|
| **Obsidian `SecretStorage`** (≥ 1.11.4) | ✅ OS-encrypted on desktop; the token never lives in a vault file |
| `data.json` | ❌ Plain text in the vault (the root cause of the fork's worst issue) |

### Bundler
| Option | Verdict |
|---|---|
| **esbuild** | ✅ Recommended. Official sample's choice |
| Vite / Rollup | Work, but a plugin doesn't need a dev server; more config for no gain |

## 6. The sync engine (the heart)

### 6.1 State
```ts
interface SyncState {
  targetKey: string;   // hash(gitlabUrl + projectId + branch + folder); change any → state ignored
  deviceId: string;    // per-device id from app.loadLocalStorage; mismatch → state ignored
  baseCommit: string;  // remote commit SHA of the last completed sync
  files: Record<string, { blob: string }>;   // path → git blob SHA at last sync (the "base")
  pending?: Record<string, { blob: string }>; // write-ahead intent for an in-flight push
}
```
If the state is missing, unreadable, or for another target or device, SyncLab runs in **safe first-sync mode**: nothing is deleted, and files that differ become conflicts. So losing the state can cost an extra prompt, never data.

### 6.2 One rule table (the only place status is decided)

For each path, `B` = base blob, `L` = local blob, `R` = remote blob (`∅` = absent):

| Case | Meaning | Action |
|---|---|---|
| `L == R` | Already identical | Record as synced. **No-op** (this is what makes it idempotent) |
| `L == B`, `R ≠ B` | Only the remote changed | Pull (or move local to trash if `R = ∅`) |
| `R == B`, `L ≠ B` | Only local changed | Push (or delete remote if `L = ∅`) |
| `B = ∅`, `L` and `R` exist and differ | No history, both have content | **Conflict** (never silent overwrite) |
| `L ≠ B`, `R ≠ B`, `L ≠ R` | Both changed | **Conflict** |
| `B = ∅`, only `L` | New local file | Push (create) |
| `B = ∅`, only `R` | New remote file | Pull |

The same pure function powers the sidebar labels and the engine, so the UI can never disagree with what Sync will do.

### 6.3 The Sync pipeline

1. **Lock.** Take the single-flight lock and snapshot settings into an immutable `RunContext`. Editing settings mid-sync affects only the next run.
2. **Remote snapshot.** `GET branches/:branch` → head `H`. If `H == baseCommit`, the remote is unchanged: skip listing (a refresh costs **one request**). Otherwise list the tree **at commit `H`**, not at the branch name, with keyset pagination, so the snapshot can't shift mid-listing.
3. **Local snapshot.** Read vault-indexed files in scope as **bytes**, minus ignore rules. Hash them, with a cache keyed by (mtime, size) so only changed files are re-hashed.
4. **Plan.** Classify each path with the table above; apply the user's checkboxes and conflict choices. If the plan deletes more than a threshold (default: 10 files or 20 % of tracked files), ask for explicit confirmation.
5. **Pull.**
   - Download each blob by SHA (`repository/blobs/:sha/raw`, immutable) and **verify that the bytes hash to the expected SHA**.
   - **Re-hash the local file** right before writing. If the user edited it during the sync, skip it and mark it as a conflict.
   - Write with `createBinary` / `modifyBinary`. Deletions go through `fileManager.trashFile` (the user's trash preference).
6. **Push.**
   - For each update, delete or move, `HEAD repository/files/:path?ref=H` gives the remote `blob id` (must equal `R`) and its `last_commit_id`.
   - Write `pending` intents, then make **one atomic commit** with all actions, each update/delete/move carrying `last_commit_id`.
   - If anything changed remotely in between, GitLab rejects the commit, and `create` fails if the file already exists. SyncLab then re-plans (max 3 attempts) instead of overwriting. GitLab's docs don't spell out the mismatch behaviour, so M0 confirms it against a real project before anything is built on it.
7. **Persist.** Update the base only for paths confirmed synced, set `baseCommit`, clear `pending`. Use crash-safe writes: write the new file, then swap, with recovery on load.
8. **Release the lock** and refresh the UI.

**Why rerunning after any failure converges:** every decision is a pure function of content hashes.
- A push whose response was lost is seen next time as `L == R` and marked synced.
- A half-applied pull resumes where it stopped.
- The `pending` intents turn the one ambiguous crash window into a clean resume instead of a false conflict.

### 6.4 Conflict resolution
- **Keep mine.** Push local over remote, using the *current* remote `last_commit_id` (a deliberate, informed overwrite).
- **Keep theirs.** Local copy goes to trash first, then pull.
- **Keep both.** Remote saved as `name (GitLab 2026-10-04 1432).md` next to yours; both sync normally afterwards.
- Unresolved conflicts don't block the rest of the sync.

### 6.5 Hard rules (never configurable)
- Never synced: `.obsidian/` (`app.vault.configDir`), `.trash/`, `.git/`, any dot-path.
- No file content is ever decoded to text, except to render a diff. Bytes in, bytes out.
- Local deletes always go through Obsidian's trash handling, never a raw file removal.
- One GitLab host per configuration; HTTPS only (`http://localhost` allowed for testing).
- Paths that differ only by case or Unicode normalization are flagged as "needs attention" and never written.

## 7. Lessons from the reference fork → SyncLab design

| Fork problem (from the audit) | SyncLab answer |
|---|---|
| Tokens could be pushed via `.obsidian/.../data.json` | Token in `SecretStorage`; config dir and dot-paths hard-excluded |
| Files without a baseline silently overwritten | No baseline + different content = conflict, always |
| Stale baselines after switching repo/branch | State keyed by target + device; mismatch → safe first-sync mode |
| Settings edits mid-sync redirected commits | Immutable `RunContext` per run |
| Two syncs could run at once | Single-flight lock; button disabled while running |
| Local delete wiped another device's edits | Delete remote only if `R == B`; otherwise conflict |
| Remote changes between review and commit overwritten | `last_commit_id` on every update/delete/move; `create` fails if the file exists; re-plan |
| GitHub files > 1 MB pulled as empty | Download raw bytes by blob SHA and verify the hash before writing |
| Binary files corrupted (extension list) | Bytes end-to-end, no extension guessing |
| Symlinks committed before confirmation | Symlinks out of scope in v1 (shown as ignored) |
| Non-atomic 200-item batches | One commit per Sync; byte-size chunking only above GitLab's request limit, each chunk independently safe |
| Tree listing could shift mid-pagination | Tree listed at a fixed commit SHA with keyset pagination |
| Settings file rewritten once per synced file | Separate state file, written once per phase |
| "Delete local" was permanent for some files | All local deletes go to trash, with confirmation |
| Esc left modals hanging | Every modal resolves to *cancel* on close |
| No rate-limit handling | Honour `429` / `Retry-After` / `RateLimit-Reset`; exponential backoff with jitter for 5xx and network errors |
| Errors detected by the text "404" | Errors mapped by HTTP status code |
| Branch names not URL-encoded | One URL builder encodes every path segment and query value |
| Status rules duplicated in 3 places | One pure `classify()` shared by UI and engine |

## 8. GitLab API surface (complete list)

| Purpose | Endpoint |
|---|---|
| Reachability / version | `GET /api/v4/version` |
| Who am I | `GET /user` |
| Pick a project | `GET /projects?membership=true&search=…` · `POST /projects` (create private) |
| Branches | `GET /projects/:id/repository/branches` · `GET …/branches/:branch` |
| Remote snapshot | `GET /projects/:id/repository/tree?ref=<sha>&recursive=true&pagination=keyset&per_page=100` |
| Download | `GET /projects/:id/repository/blobs/:sha/raw` |
| Lock info | `HEAD /projects/:id/repository/files/:path?ref=<sha>` → `X-Gitlab-Blob-Id`, `X-Gitlab-Last-Commit-Id` |
| Commit | `POST /projects/:id/repository/commits` with `actions[]` (`create` / `update` / `delete` / `move`, `encoding: base64`, `last_commit_id`) |
| Root `.gitignore` | covered by tree + blob download |

GitLab-documented limits we design around:
- Requests larger than 300 MB are rejected.
- Requests over 20 MB are rate-limited (3 per 30 s).
- Blobs over 10 MB: 5 downloads per minute.

SyncLab's default per-file limit will be 20 MB, configurable, with clear UI when a file is skipped.

## 9. Project structure

```
SyncLab/
├─ manifest.json · versions.json · package.json · tsconfig.json
├─ esbuild.config.mjs · eslint.config.mjs · vitest.config.ts · svelte.config.js
├─ styles.css
├─ src/
│  ├─ main.ts                 # lifecycle only: view, commands, ribbon, status bar, settings tab
│  ├─ core/                   # PURE — no 'obsidian' imports (lint-enforced)
│  │  ├─ blobHash.ts          # git blob SHA-1 of bytes
│  │  ├─ classify.ts          # the one rule table
│  │  ├─ planner.ts           # snapshots + choices → SyncPlan
│  │  └─ types.ts
│  ├─ engine/
│  │  ├─ SyncEngine.ts        # lock → snapshot → plan → pull → push → persist
│  │  ├─ LocalVault.ts        # Vault API: list, read bytes, write, trash + hash cache
│  │  ├─ StateStore.ts        # crash-safe, target/device-stamped state
│  │  └─ ignore.ts            # hard excludes + .gitignore + user patterns
│  ├─ gitlab/
│  │  ├─ GitLabClient.ts      # requestUrl wrapper: auth, retry, rate limit, status→error
│  │  └─ api.ts               # typed endpoints from §8
│  └─ ui/
│     ├─ SyncLabView.ts       # ItemView (right sidebar) mounting Svelte
│     ├─ components/          # Sidebar, SyncButton, ChangeList, ChangeRow, CommitBox, ConflictCard
│     ├─ modals/              # Onboarding wizard, DiffModal, ConfirmModal
│     ├─ settings/            # SettingsTab (uses SecretComponent)
│     └─ theme.css            # neo-brutal tokens
├─ tests/
│  ├─ core/ · engine/          # Vitest with FakeGitLab + FakeVault
│  ├─ property/                # fast-check: idempotency + two-device convergence
│  └─ contract/                # opt-in, real GitLab test project
└─ docs/  PLAN.md · DESIGN.md · TESTING.md
```

Dependency direction: `ui → engine → core`, `engine → gitlab`. `core` imports nothing from Obsidian or the network.

## 10. Testing strategy

1. **Core unit tests:** every row of the rule table, hashing against known git blob SHAs (empty file, CRLF, BOM, binary, 10 MB).
2. **Engine tests** with FakeGitLab (simulates `last_commit_id` rejection, `create`-exists, 429s, timeouts after commit) and FakeVault (simulates edits during sync).
3. **Property tests (the idempotency proof).** Generate random interleavings of edits, deletes, renames and crashes on two devices plus the remote, then assert:
   - **Convergence:** after syncs settle, both devices equal the remote.
   - **Idempotency:** a second Sync makes zero writes and zero requests beyond the head check.
   - **No silent loss:** every edit survives, either synced or as a conflict copy.
4. **Contract tests** against a real GitLab project: they lock in the API behaviours from §8.
5. **Manual QA matrix:**
   - Windows desktop, Android/iOS.
   - Light and dark themes.
   - A 5,000-file vault.
   - Airplane mode mid-sync.
   - Editing a note during a sync.

## 11. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | **API spike**: confirm `last_commit_id` rejection, `create`-exists error, blob SHA equality for binary/CRLF/BOM, `requestUrl` HEAD headers, `SecretStorage` on mobile | Findings written to `docs/TESTING.md`; contract tests pass |
| M1 | **Core**: hashing, rule table, planner, StateStore, fakes, property tests | Property tests green over 10k random runs |
| M2 | **GitLab client**: endpoints, retries, rate limits, pagination, chunking | Contract suite green on gitlab.com |
| M3 | **Sidebar + Sync button**: change list, checkboxes, commit message, diff, conflicts | Sync works end-to-end on desktop |
| M4 | **Onboarding wizard + settings + SecretStorage + status bar** | A fresh user is set up without reading docs |
| M5 | **Hardening**: mobile, large vaults, mass-delete guard, accessibility, reduced motion | QA matrix passes |
| M6 | **Release**: README (with network disclosure), LICENSE, CI release, BRAT beta, submission | Listed in the Obsidian community directory |

## 12. Publishing on Obsidian (current process, 2026)

Obsidian replaced the old pull-request queue in May 2026 with a **community portal** and automated review.

1. **Host the source on GitHub (public).**
   - The portal links your GitHub account to verify repo ownership, and installs come from **GitHub releases**.
   - SyncLab can still *sync notes to GitLab*. Only the plugin's source must be on GitHub. You can also develop on GitLab and push-mirror to GitHub.
2. **Repo root must contain:**
   - `README.md` (its excerpts appear on the listing);
   - `LICENSE`;
   - `manifest.json`, with a unique `id` that must not contain "obsidian". Proposed id: `synclab`, which is unused among the 8,364 listed plugins as of 2026-10-04.
3. **README disclosures** (required by Obsidian's developer policies):
   - **Network use:** "SyncLab connects only to the GitLab server you configure, to read and write files in the repository you choose."
   - **Account:** a GitLab account is required.
   - **No telemetry.** Client-side telemetry, obfuscation, ads and self-updating code are not allowed.
4. **Release:**
   - Bump `version` (semver `x.y.z`) in `manifest.json` and `versions.json`.
   - Push a tag **exactly equal** to the version (`1.0.0`, no `v`).
   - The GitHub Action creates the release with `main.js`, `manifest.json` and `styles.css` attached.
5. **Beta first:** install your own builds on desktop and phone with the **BRAT** plugin, straight from the GitHub repo.
6. **Submit:**
   - Sign in at **community.obsidian.md**, link GitHub, and add the plugin. The portal reads `manifest.json` from your default branch.
   - Automated review (security, code quality, malware) reports in minutes; listing follows within about 24 h.
   - If it flags anything, fix it and publish a new version.
7. **Updates:** every new tagged release reaches users through Obsidian's normal plugin updates.
8. **Coming soon:** Obsidian plans capability disclosures (network, file system, …) shown before install. SyncLab will declare **network** only.

Licensing note: write SyncLab from scratch and borrow ideas only. The reference fork is MIT (fine to learn from; keep its notice if any code is reused). The closest existing plugin, "GitLab Gitless Sync", is AGPL-3.0, so don't copy its code.

## 13. Decisions (confirmed 2026-10-04)

1. **Sync direction:** two-way. One press pulls GitLab changes and pushes local ones.
2. **UI layer:** Svelte 5.
3. **Platforms:** desktop and mobile in v1 (`isDesktopOnly: false`).
4. **Code hosting:** GitHub (public repo, releases published from there).

## 14. Sources

- Obsidian, *Submit your plugin*: https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin
- Obsidian, *The future of plugins* (May 12, 2026): https://obsidian.md/blog/future-of-plugins/
- Obsidian, *Developer policies*: https://docs.obsidian.md/Community+directory/Developer+policies
- Obsidian, *Plugin guidelines*: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Obsidian, *Secret storage*: https://docs.obsidian.md/plugins/guides/secret-storage
- GitLab, *Commits API*: https://docs.gitlab.com/api/commits/
- GitLab, *Repository files API*: https://docs.gitlab.com/api/repository_files/
- GitLab, *Repositories API*: https://docs.gitlab.com/api/repositories/
- GitLab, *Token scopes*: https://docs.gitlab.com/security/tokens/access_token_scopes/
- GitLab, *Personal access tokens* (prefill URL): https://docs.gitlab.com/user/profile/personal_access_tokens/
- Obsidian community plugin list: https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugins.json

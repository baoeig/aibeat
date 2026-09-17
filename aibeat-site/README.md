# AI Beat Website

This folder contains the Mintlify company site for AI Beat's two separate evaluation products:

- PromptBeat, publicly packaged for model and Prompt red-team evaluation with the current Promptfoo backend
- AgentBeat, implemented in the development repository for black-box HTTP Agent evaluation without Promptfoo; this branch includes local website-preview packages supporting `eval-run`, not an official public Release

The website has no new runtime/npm dependency. Preview-asset rebuilding now additionally requires Python 3.11+, installed Go 1.24.9 and the existing module cache. The builder runs offline with `GOTOOLCHAIN=local` and `GOPROXY=off`; it does not install a compiler or modules. Set `GO` to the installed 1.24.9 compiler if the default `go` has another version. These local candidates do not establish publicly available matching source or distribution permission.

## Structure

- Framework: Mintlify
- Site configuration: `docs.json`
- English content: root MDX sections such as `promptbeat/` and `agentbeat/`
- Chinese content: mirrored MDX under `cn/`
- Site dependencies: `package.json` and `package-lock.json`
- Bilingual contract checker: `scripts/check-bilingual.mjs`
- Site-owned Skills download: `downloads/promptbeat-skills.zip` and `.sha256`
- Reproducible Skills packager: `scripts/build-skills.mjs` (Node built-ins only)
- AgentBeat preview packager/tests: `../scripts/{build,test}-agentbeat-eval-preview.py`
- Isolated packaged-CLI contract check: `../scripts/check-agentbeat-eval-preview.py`

## Run locally

```bash
cd aibeat-site
npm ci
npm run dev -- --port 39002
```

Choose another free `3900x` port when 39002 is occupied. For hosts with exhausted inotify watches, run the preview with `WATCHPACK_POLLING=true CHOKIDAR_USEPOLLING=true`.

## Validate

```bash
cd aibeat-site
npm run build
npm run check
npx mint validate --disable-openapi
npm run qa:visual
npm run qa:onboarding
```

`npm run build` builds the independent Astro Community site, exports the Mintlify main site to ignored `.build/aibeat-site.zip`, and verifies all 44 exported routes plus Mintlify's automatic inclusion of `localization.js`. A successful Community static build does not by itself publish that subtree through Mintlify. The export check compares all seven downloadable assets (Skills ZIP/checksum and four AgentBeat archives/checksum) byte-for-byte with their source files.

`npm run check` includes four Skills tests and five AgentBeat packager unit tests, four-platform byte-for-byte recompilation, bilingual link parity and Mintlify broken links. `npm run qa:onboarding` requires the live preview plus a workspace-owned `TMPDIR`; it uses real Chrome clicks to download Skills, the Linux PromptBeat full package and the Linux AgentBeat preview/checksum from both languages, checks hashes and tests guide navigation and both Skill directory layouts. The downloaded AgentBeat archive runs with fixed localhost Target/Judge stubs in a fresh loopback-only network namespace and a credential-free environment. This requires Linux `unshare --net` permission and `ip`; failure stops the test, never falls back to host networking. It is protocol integration, not a real Agent/model evaluation or coding-assistant execution. The existing `unzip` system tool is also used to independently check ZIP CRCs. Run Mintlify build/validate and browser QA sequentially, not concurrently against the shared local preview.

After editing `../promptbeat-skills/`, run `npm run build:skills` and commit the source, generated ZIP and checksum together. The ZIP intentionally excludes historical test notes and contains a per-file manifest. It is a website artifact, not a new GitHub Release.

## Deployment notes

No production domain is configured here. Product download links are pinned to the real PromptBeat v0.2 full-package assets, not the repository-wide latest release. Public AgentBeat v0.3-agentbeat-preview.1 is a legacy adapter release, not the current `eval-run` evaluator. This branch's website previews are local candidates, not a published GitHub Release. Public matching source, distribution/license permission and release approval remain unresolved; do not deploy these new executable assets until those gates are explicitly settled. Before any deployment, verify the public origin, `/cn` root routing, raw Chinese-page `lang` metadata, redirects, and Community hosting in the actual deployment preview. Keep generated reports, benchmark artifacts, secrets, and unsanitized evaluation data out of this folder.

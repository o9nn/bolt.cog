# Electron desktop builds and draft releases

`desktop/` is a standalone package named `bolt-cog-desktop`, version **0.1.1**. It loads `https://bolt-cog.pages.dev`, with Cloudflare Access at `https://rzo.cloudflareaccess.com`. It is an online desktop client, not a local development agent. No preload script, IPC bridge, provider secret, runner credential or host-command executor is bundled. The existing model and cognitive application paths are unchanged.

Remote renderers have Node integration disabled, context isolation and process sandboxing enabled, web security enabled, restricted navigation/window creation and default-denied permission requests. Exact authentication origins are in `desktop/app.config.json`; review additions before rebuilding. Downloads from the application or its Blob origin use a native save dialog. There is no certificate bypass or sandbox-disable flag. [1] [2]

## Build locally

Use Node **22.12.0 or newer** and **pnpm 9.4.0**. The desktop manifest and independent lockfile pin **Electron 45.3.2** and **electron-builder 26.18.0**. Root application dependencies and its lockfile are not changed.

From the repository root:

```bash
pnpm --dir desktop install --frozen-lockfile
pnpm --dir desktop test
pnpm --dir desktop start

# Package on the corresponding operating system.
pnpm --dir desktop exec electron-builder --linux --x64 --publish never
pnpm --dir desktop exec electron-builder --linux --arm64 --publish never
pnpm --dir desktop exec electron-builder --win --x64 --publish never
pnpm --dir desktop exec electron-builder --mac --x64 --publish never
pnpm --dir desktop exec electron-builder --mac --arm64 --publish never
```

Pass builder arguments through `exec` without an additional `--`. Use `--publish never`; release assembly is a separate workflow job. Desktop tests use explicitly named Node test files, outside the web app's Vitest discovery. [3] [4]

Outputs are Linux AppImage/deb, Windows NSIS setup/portable EXE, and macOS DMG/ZIP. Filenames include version, OS and architecture; Windows targets also include setup/portable. No byte-for-byte reproducibility claim is made across different runner images.

The package contains only the desktop entry points, configuration, offline HTML and icon, plus a controlled diagnostic module. Web application files, the earlier uncommitted chat/runner patch, credentials and unrelated repositories are not bundled. Icons are converted from this repository's existing `public/favicon.svg`.

## Real packaged launch testing

Install Electron's native libraries and Xvfb/Xauth for headless Linux tests. The Ubuntu 24.04 dependency list is in `.github/workflows/electron-release.yml`. Launch as a normal user, not root. AppImage execution may require FUSE 2; use unpacked output for the direct executable smoke test.

```bash
# Linux x64 on an x64 host:
export BOLT_DESKTOP_SMOKE_BINARY="$PWD/desktop/dist/linux-unpacked/bolt-cog-desktop"
pnpm --dir desktop smoke

# Linux arm64 on an arm64 host:
export BOLT_DESKTOP_SMOKE_BINARY="$PWD/desktop/dist/linux-arm64-unpacked/bolt-cog-desktop"
pnpm --dir desktop smoke
```

When no display exists, the launcher uses Xvfb. Each test uses a fresh disposable profile. It checks an actual packaged renderer, isolation preferences, absence of renderer Node APIs, blocked unsafe popup/navigation, and the actual offline recovery page. It prints `ELECTRON_SMOKE_RESULT` with whether the live app or Access page loaded. An offline result must not be described as a successful live connection.

The host must support Chromium's sandbox through user namespaces or its correctly installed setuid helper. CI changes ownership/mode only for the verified `chrome-sandbox` file in its ephemeral unpacked output. No app command gains OS elevation. Do not disable host protections globally or use `--no-sandbox`. [2]

Local Linux ARM64 validation reached the real Access sign-in page with `sandbox:true`, `nodeIntegration:false`, `contextIsolation:true` and `webSecurity:true`. Access login is not a test of authenticated application inference or WebContainer boot. Its page reported `crossOriginIsolated:false`; the application must retain its COOP/COEP headers after sign-in. The smoke test does not bypass authentication, submit an email code, or replace an inference engine.

Network failure displays a local error/reconnect page, not an offline model or development workspace. Reconnect, opening the fixed deployment in a browser, export/save and local-data clearing are available through native menus. Local data clearing requires confirmation and removes desktop browser storage only; export unsaved work first.

Some identity providers restrict embedded-browser sign-in. Test the intended Access identity flow on distributed platforms; opening the deployment in a system browser does not automatically transfer that browser's session into Electron.

## GitHub Actions and downloads

Five native packaging lanes use `ubuntu-24.04` for Linux x64, `ubuntu-24.04-arm` for Linux arm64, `windows-2022` for Windows x64, `macos-15-intel` for macOS x64 and `macos-15` for macOS arm64. Both Linux lanes run the actual packaged smoke test under Xvfb. Windows and macOS lanes package installers but do not establish native GUI launch certification.

The initial `desktop-v0.1.0` attempt used macOS 14, which GitHub retired on 2 November 2026. GitHub rejected those runner configurations before execution. The old tag is preserved; **0.1.1** fixes the matrix and requests a new draft without rewriting tag history. Supported replacements were verified against official GitHub documentation. [8] [9]

The workflow runs for matching desktop path changes on pull requests and `feat/electron-desktop-release`, tag pushes matching `desktop-v*`, and manual dispatch. Manual dispatch only appears in the UI after the workflow reaches the default branch. Every lane validates tool pins and SemVer, installs the frozen desktop lockfile, runs policy tests, packages without publishing, and requires nonempty expected installer files.

Build jobs have only `contents:read`, do not persist checkout credentials and receive no signing secrets. Actions are pinned to official-repository commit SHAs. Uploaded installer artifacts are retained for 14 days; unpacked apps, dependency trees and builder metadata are excluded.

Download `desktop-linux-x64`, `desktop-linux-arm64`, `desktop-win-x64`, `desktop-mac-x64` and `desktop-mac-arm64` from the completed Actions run. Manual dispatch uploads artifacts only, including when a tag is selected.

## Version-matched draft releases

The current tag is **`desktop-v0.1.1`**, exactly matching the standalone desktop version. Future tags must contain valid SemVer and match `desktop/package.json`; the root app does not require a version bump. `desktop/scripts/check-version.cjs` enforces this before packaging and release writes.

Only the separate release job receives `contents:write`. It runs on a matching tag push after all five packaging jobs succeed. It requires every artifact group, rejects empty/duplicate/unexpected assets, assembles installers and generates/validates `SHA256SUMS`.

The GitHub CLI creates a **draft**, verifies that the tag exists and checks uploaded asset names and sizes. Reruns can update an existing draft but refuse to modify a published release. A failed upload may leave a partial draft; verify completeness before publication. No step automatically publishes a release. [6]

```bash
# Installers and manifest in one directory:
sha256sum --check SHA256SUMS
# macOS alternative:
shasum -a 256 -c SHA256SUMS
```

On Windows compare `Get-FileHash -Algorithm SHA256` with the manifest. Checksums detect changed downloads, not publisher identity; they are not code signatures.

## Production distribution gates

These are **unsigned maintainer previews**, not approved production installers. Windows SmartScreen or macOS Gatekeeper can warn or block. Do not globally disable those protections. Configure Windows Authenticode and macOS Developer ID signing, notarization and stapling in separately reviewed protected CI environments before public production distribution. The current workflow passes no signing credentials and has no fake signing/notarization script. [5] [7]

Verify native installation/launch on each OS and architecture, the intended Access identity-provider flow, authenticated chat/inference, WebContainer terminal/preview, exports and session persistence. The Electron wrapper cannot fix or certify an undeployed server patch. Review existing web application dependency vulnerabilities independently; this desktop change does not remediate the root app's dependency graph.

Review all matrix results, real launch evidence, complete checksums and signing/notarization evidence before any manual publication. No desktop updater is implemented; a GitHub release is not an auto-update channel. No local Linux runner or host sudo bridge is included.

## References

[1]: https://electronjs.org/docs/latest/tutorial/security "Electron security checklist"
[2]: https://www.electronjs.org/docs/latest/tutorial/sandbox "Electron process sandboxing"
[3]: https://www.electron.build/v26/cli.html "electron-builder stable v26 CLI"
[4]: https://www.electron.build/v26/docs/publish "electron-builder stable v26 publishing"
[5]: https://www.electron.build/v26/docs/features/code-signing/code-signing-mac "electron-builder stable v26 macOS signing"
[6]: https://cli.github.com/manual/gh_release_create "GitHub CLI draft release creation"
[7]: https://www.electron.build/v26/docs/features/code-signing/code-signing-win "electron-builder stable v26 Windows signing"
[8]: https://github.blog/changelog/2026-10-01-github-actions-macos-14-runner-image-retirement/ "GitHub macOS 14 image retirement"
[9]: https://docs.github.com/en/actions/reference/runners/github-hosted-runners "Supported GitHub-hosted runner labels"

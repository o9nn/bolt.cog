# Electron desktop builds and draft releases

`desktop/` is a standalone package named `bolt-cog-desktop`, initially version `0.1.0`. It loads `https://bolt-cog.pages.dev`, with authentication navigation to `https://rzo.cloudflareaccess.com`. It is a sandboxed client of the hosted application, not a local development agent: there is no preload script, IPC bridge, or host-command execution. Network failure displays an error/retry screen, not an offline workspace.

The runtime policy must keep Node integration disabled, context isolation and sandboxing enabled, navigation/window creation restricted, and remote permission requests denied unless explicitly allowed. Review Electron's official security checklist when changing this boundary. [1] [2]

## Build locally

Use Node.js **22.12.0 or newer** and **pnpm 9.4.0**. The desktop manifest and lockfile pin **Electron 45.3.2** and **electron-builder 26.18.0**. Do not install the root application or regenerate its lockfile for desktop packaging.

From the repository root:

```bash
pnpm --dir desktop install --frozen-lockfile
pnpm --dir desktop test

# Run the appropriate command on the target platform.
pnpm --dir desktop exec electron-builder --linux --x64 --publish never
pnpm --dir desktop exec electron-builder --linux --arm64 --publish never
pnpm --dir desktop exec electron-builder --win --x64 --publish never
pnpm --dir desktop exec electron-builder --mac --x64 --publish never
pnpm --dir desktop exec electron-builder --mac --arm64 --publish never
```

Use `exec` to pass builder arguments directly; do not add an extra `--` between `electron-builder` and its flags. `--publish never` is mandatory because builder otherwise has automatic CI publishing rules. These commands package installers only. [3] [4]

For local preview builds, leave signing credentials unset and use `CSC_IDENTITY_AUTO_DISCOVERY=false` to avoid macOS keychain discovery. The workflow passes no signing secrets. In stable builder v26, a missing signing identity skips signing; `mac.identity: null` explicitly disables it. Ad-hoc signing is a separate opt-in, not Developer ID signing or notarization, and is not configured by this workflow. [5]

Expected installer files are `desktop/dist/*.AppImage` and `*.deb` for Linux, `*.exe` for Windows, and `*.dmg` and `*.zip` for macOS. OS and architecture must appear in installer filenames so x64 and arm64 assets cannot overwrite one another. The package name, version and configured application identity are stable inputs; unsigned does **not** mean byte-for-byte reproducible across runner images or build dates.

### Linux packaged launch smoke

Install Xvfb, Xauth and Electron's native libraries before running a headless smoke test. The exact Ubuntu 24.04 dependency list is in `.github/workflows/electron-release.yml`; it includes GTK, NSS, GBM, ALSA and the X11 libraries. AppImage execution may also require FUSE 2 support. Launch as a normal user, not root.

After packaging Linux x64 on an x64 host:

```bash
export BOLT_DESKTOP_SMOKE_BINARY="$PWD/desktop/dist/linux-unpacked/bolt-cog-desktop"
xvfb-run -a --server-args='-screen 0 1280x800x24' pnpm --dir desktop smoke
```

For a local arm64 build on an arm64 host, use `desktop/dist/linux-arm64-unpacked/bolt-cog-desktop` instead. The smoke script must launch the actual packaged executable and fail if it cannot start; policy/unit tests alone do not demonstrate a real Electron launch.

The Linux host must permit Chromium's sandbox through supported user namespaces or a correctly installed setuid sandbox helper. If using the packaged `chrome-sandbox` helper, its ownership must be `root:root`, its mode `4755`, and its filesystem must permit setuid execution. Only an administrator should apply that ownership/mode to a verified helper in a controlled installation. CI configures the helper only inside its ephemeral x64 runner's unpacked output. Ubuntu AppArmor/user-namespace policy, containers and `nosuid` mounts can still prevent launch; diagnose the host policy rather than disabling it globally. **Never add `--no-sandbox` to the application or smoke test.** [2]

## GitHub Actions coverage and downloads

The workflow runs for pull requests changing `desktop/**`, the workflow itself, or this guide; matching path changes pushed to `feat/electron-desktop-release`; manual dispatch; and pushes of `desktop-v*` tags. GitHub does not apply push path filters to tag pushes. Manual dispatch must be available on the repository's default branch before it appears in the Actions UI.

Five independent lanes use Ubuntu 24.04 for Linux x64 and cross-packaged Linux arm64, Windows 2022 for Windows x64, and macOS 14 for separate macOS x64 and arm64 packages. Every lane verifies manifest pins and installed dependency versions, installs with the frozen desktop lockfile, runs desktop tests, packages with publishing disabled, and requires each expected nonempty installer target. Missing files are failures, not warnings. The x64 Linux lane additionally launches the packaged app under Xvfb after packaging. Cross-packaged Linux arm64 and both Windows/macOS lanes are packaging checks, **not** native launch certification.

Build jobs have only `contents: read`, do not persist checkout credentials, and receive no signing secrets. Third-party actions are pinned to full commit SHAs, resolved from their official repositories; update pins deliberately after reviewing upstream changes.

Download these artifacts from the completed Actions run:

- `desktop-linux-x64` and `desktop-linux-arm64`
- `desktop-win-x64`
- `desktop-mac-x64` and `desktop-mac-arm64`

Only actual installers are uploaded, with a 14-day retention period. Unpacked applications, dependency trees and builder metadata are excluded. A manual dispatch produces these artifacts only, even when the selected ref is a release tag; it never creates a release.

## Version-matched, draft-only releases

The initial release tag is **`desktop-v0.1.0`**, exactly matching `desktop/package.json`. A maintainer may push the matching tag on a reviewed commit when ready to request a draft. Future tags must be `desktop-v` followed by valid SemVer and equal the desktop version; changing the root application version is not a desktop release version bump. `desktop/scripts/check-version.cjs` reads `GITHUB_REF_NAME` and runs on tag builds and again immediately before release assembly.

The separate `draft-release` job can run only on a matching **tag push**, after **all five** matrix lanes succeed. Only that job receives `contents: write`. It downloads artifacts from the current run, checks every platform/architecture group and target, rejects empty files or duplicate names, gathers actual installers, and generates `SHA256SUMS`. It verifies the manifest before uploading.

The job uses GitHub CLI to create a **draft** with `--verify-tag --draft`, or update assets on an existing draft with `--clobber`. It preserves maintainer-edited notes on reruns and refuses to modify an already published release. Readback requires the release to remain a draft and every expected asset to exist with the correct size. Failed jobs may leave a partial draft; fix the failure and rerun, then verify the complete asset set. No workflow step publishes the release or creates a missing tag. [6]

After downloading the draft's installers and `SHA256SUMS` into the same directory, verify them with:

```bash
sha256sum --check SHA256SUMS
```

On macOS use `shasum -a 256 -c SHA256SUMS`; on Windows compare `Get-FileHash -Algorithm SHA256` output with the corresponding manifest line. Checksums detect changed downloads; they are not code signatures or proof of publisher identity.

## Remaining production gates

These are **unsigned maintainer previews**. Windows may show SmartScreen warnings; macOS may block an untrusted or unnotarized app. Verify origin and checksums before considering an individual local approval. Do not disable Gatekeeper, SmartScreen or the Chromium sandbox globally. Native installer/launch testing is still required on each distributed OS and architecture, including Linux arm64.

Before production distribution, separately configure and review Windows Authenticode signing with an approved certificate or trusted signing service, and macOS Developer ID signing, hardened runtime/entitlements, Apple notarization and ticket stapling. Store any required credentials in protected CI environments/secrets; do not commit certificates, passwords, API keys or tokens, print them in logs, or expose them to pull-request builds. Optional signing configuration is not implemented here, and no fake signing/notarization script is provided. Consult stable **v26** documentation, not unreleased v27 configuration or verification commands. [5] [7]

A maintainer must review the sandbox policy, real platform launch results, signing/notarization evidence and the complete checksum manifest before any separate manual publication. Draft creation is not approval for production release. This workflow provides no desktop auto-update channel; publishing a GitHub release alone does not install an updater.

## References

[1]: https://electronjs.org/docs/latest/tutorial/security "Electron security checklist"
[2]: https://www.electronjs.org/docs/latest/tutorial/sandbox "Electron process sandboxing"
[3]: https://www.electron.build/v26/cli.html "electron-builder stable v26 CLI"
[4]: https://www.electron.build/v26/docs/publish "electron-builder stable v26 publishing"
[5]: https://www.electron.build/v26/docs/features/code-signing/code-signing-mac "electron-builder stable v26 macOS signing"
[6]: https://cli.github.com/manual/gh_release_create "GitHub CLI draft release creation"
[7]: https://www.electron.build/v26/docs/features/code-signing/code-signing-win "electron-builder stable v26 Windows signing"

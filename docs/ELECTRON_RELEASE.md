# Electron desktop builds and releases

The published **desktop-v0.1.1** release is the original hosted-app desktop shell, merged through PR #1. The new **0.2.0** source integrates the actual UI, Remix API routes, real provider streaming and a scoped Agent-Zero native adapter locally. See [LOCAL_DESKTOP_RUNTIME.md](LOCAL_DESKTOP_RUNTIME.md) for configuration, security boundaries and remaining browser-engine network dependencies. It does not load `bolt-cog.pages.dev` or require Cloudflare Access.

## Build

Use Node22.12+ and pnpm9.4.0. Electron45.3.2 and electron-builder26.18.0 remain pinned. Both the root application dependencies and standalone desktop dependencies are required to build the complete runtime:

```bash
pnpm install --frozen-lockfile
pnpm --dir desktop install --frozen-lockfile
pnpm run build:desktop
pnpm typecheck
pnpm test
pnpm --dir desktop test
pnpm --dir desktop start

# Native targets; use the corresponding native OS/architecture.
pnpm --dir desktop exec electron-builder --linux --x64 --publish never
pnpm --dir desktop exec electron-builder --linux --arm64 --publish never
pnpm --dir desktop exec electron-builder --win --x64 --publish never
pnpm --dir desktop exec electron-builder --mac --x64 --publish never
pnpm --dir desktop exec electron-builder --mac --arm64 --publish never
```

The packager rejects stale runtime source/version fingerprints. Rebuild after changing source. The installer contains the local utility-process backend, client assets, the guarded main process, offline recovery UI, exact settings-only IPC interface and Bolt icons. It does not include model weights, an inference executable, `.env` files, API keys, GitHub credentials or the separate Linux runner daemon. Model/inference installation is explicit and remains real rather than a simulated local substitute.

Native settings support an OpenAI-compatible local endpoint and optional direct Anthropic. OS-encrypted keys, endpoint scoping, session-only fallback and missing-provider error handling are documented in the local guide. The primary app renderer remains sandboxed with Node disabled, isolated context and web security. No host sudo or arbitrary terminal bridge is granted.

## Validation

Linux packaged smoke uses a fresh disposable profile and actual Electron launch:

```bash
BOLT_DESKTOP_SMOKE_BINARY="$PWD/desktop/dist/linux-arm64-unpacked/bolt-cog-desktop" \
pnpm --dir desktop smoke
```

Without a display, use the provided Xvfb launcher. Preserve Chromium's sandbox; never use `--no-sandbox` or disable host security globally. Ephemeral CI sets only its packaged `chrome-sandbox` helper to the verified owner/mode. This does not grant model-driven OS elevation.

Smoke receipts establish local UI loading, cross-origin isolation, renderer Node denial, unsafe popup/navigation denial and absence of requests to the hosted Cloudflare app. Real model smoke requires a separately running configured endpoint and `BOLT_DESKTOP_SMOKE_CHAT=1`; it cannot pass by fabricating an inference response. `BOLT_DESKTOP_SMOKE_WEBCONTAINER=1` additionally activates disposable browser-sandbox Node/process/HTTP/iframe tests. That optional test requires the actual WebContainer vendor runtime and preview services. Packaged Windows/macOS build success alone is not native GUI/inference certification.

## CI and release

Five native build lanes remain: Ubuntu24.04 x64, Ubuntu24.04-arm arm64, Windows2022 x64, macOS15-intel x64, macOS15 arm64. The retired macOS14 attempt/tag is preserved; no immutable tag is rewritten. Each lane installs frozen dependencies, builds the actual local app, type-checks, tests the portable application and desktop security policies, and packages nonempty target installers. The standalone Linux-runner integration test runs only on Linux. Both Linux lanes smoke-test the actual packaged app.

Build jobs have contents:read, pinned action SHAs, no persisted checkout credentials and no signing secrets. On a version-matched `desktop-v*` tag push, a separate contents:write job requires all five complete artifact groups, validates names/sizes, generates SHA256SUMS and assembles a **draft**. It refuses to modify a published release on rerun. Manual dispatch makes downloadable CI artifacts, not an automatically public release.

A draft is not publication. Verify complete installers, checksums and evidence before publishing. User approval published the existing 0.1.1 release; that release does not retroactively become the local 0.2.0 implementation. Keep version/tag/source distinctions explicit.

## Distribution gates

Installers remain **unsigned**, and macOS is not notarized. Windows SmartScreen and macOS Gatekeeper can warn or block. Do not globally bypass them. Windows Authenticode, Apple Developer ID signing/notarization/stapling, protected signing environments, native install/launch acceptance on each target, exports/storage persistence and realistic model quality are remaining production distribution gates. A GitHub release is not an implemented automatic update channel.

WebContainer vendor runtime/preview services and package downloads can require internet even with the application UI/backend hosted locally. Native arbitrary build/install execution requires a separately reviewed isolated executor; it is not silently enabled in the desktop port. Existing root dependency vulnerabilities and unrelated cognitive/GGML scaffolding require their own review.

## References

- https://electronjs.org/docs/latest/tutorial/security
- https://electronjs.org/docs/latest/tutorial/sandbox
- https://electronjs.org/docs/latest/api/utility-process
- https://electronjs.org/docs/latest/api/safe-storage
- https://www.electron.build/v26/cli.html
- https://www.electron.build/v26/docs/publish
- https://www.electron.build/v26/docs/features/code-signing/code-signing-mac
- https://www.electron.build/v26/docs/features/code-signing/code-signing-win
- https://cli.github.com/manual/gh_release_create
- https://docs.github.com/en/actions/reference/runners/github-hosted-runners

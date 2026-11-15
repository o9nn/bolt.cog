# Bolt Cog C — native builds and draft releases

Bolt Cog C is the **C17-only coding edition**, identified separately from the existing desktop releases. The initial intended version is **0.3.3**, with tag **`c-desktop-v0.3.3`**, display/product name **Bolt Cog C**, and application ID **`org.o9nn.boltcog.c17`**. The package name and executable remain `bolt-cog-desktop` so the existing frozen build dependency pins can be reused. Installer filenames start with `BoltCog-C-<version>-` and include the target OS and architecture.

The workflow is [.github/workflows/c-edition-release.yml](../.github/workflows/c-edition-release.yml). The existing `electron-release.yml`, its `desktop-v*` namespace, shared version validator, and already published official releases are not repurposed or overwritten by this workflow. A release tag is a maintainer action after validation; adding this workflow does not itself create a tag, run CI or create a release.

## What ships, and what does not

The installer bundles the real C-edition UI and local Node application backend. Code generation needs a **separately configured real AI endpoint/model**. No inference engine or model weights are bundled, and the release workflow does not claim to test real AI inference or generation quality. Do not treat mocked provider responses, UI load success or build success as model evidence.

C compilation and execution use the secure Docker adapter. A trusted Docker CLI and engine supporting **Linux containers** must be installed separately. The operator must explicitly obtain the exact digest-pinned GCC image declared in [`desktop/c-edition.json`](../desktop/c-edition.json); the adapter does not silently install Docker or pull mutable image tags. Missing engine, missing image or inadequate security/resource enforcement must produce setup-unavailable/failure, not a host-shell fallback.

**The resulting programs are GNU/Linux binaries**, including when the desktop UI runs on Windows/macOS with Docker Desktop. These builds are not Windows-native or macOS-native C compilation toolchains. Docker Desktop availability, paths, socket/pipe access and engine policy require explicit operator setup and platform acceptance testing. Neither non-Linux CI lane establishes working Docker execution.

The C container policy forbids host bind mounts and Docker-socket mounts, disables container networking, and enforces memory/swap, CPU, PID and seccomp constraints. CI must not weaken these controls to obtain a passing result. Docker is an explicitly trusted and powerful host dependency; container confinement is not a guarantee against engine or kernel vulnerabilities. The host runner socket is used by the trusted adapter/CLI only, never mounted into a generated program's container.

## Build and local validation

Use **Node 22.12+**, **pnpm 9.4.0**, **Electron 45.3.2** and **electron-builder 26.18.0**. Both dependency installations remain frozen:

```bash
pnpm install --frozen-lockfile
pnpm --dir desktop install --frozen-lockfile
pnpm run build:desktop
pnpm test
pnpm typecheck
pnpm --dir desktop test
```

On Windows/macOS, replace the application `pnpm test` command with:

```bash
pnpm exec vitest --run --exclude app/lib/.server/native-execution.spec.ts
```

That exclusion applies only to the existing separate Linux-native service integration. It does not certify the new Docker adapter on those platforms. The real C integration is a **separate, opt-in Linux step**, not a substitute for the application or desktop security suites:

```bash
# On a disposable Linux environment with an enforcing Docker engine already available.
# This explicitly installs the trusted image; never substitute a floating tag.
image="$(node -p "require('./desktop/c-edition.json').image")"
/usr/bin/docker --host unix:///var/run/docker.sock image pull "$image"

BOLT_C_INTEGRATION=1 \
BOLT_C_DOCKER_PATH=/usr/bin/docker \
BOLT_C_DOCKER_HOST=unix:///var/run/docker.sock \
node desktop/tests/c-integration.cjs
```

Inspect `docker info` and the adapter preflight before testing. Linux execution requires actual memory/swap, CPU quota, PID and builtin seccomp enforcement. The adapter must also inspect the actual containers; an engine capability check alone is insufficient. Retain the integration test's JSON receipts for successful compilation/execution, compiler/runtime failure exits, source hashes, runtime stdout/stderr and security denials. A failing test must fail CI, even when its output is piped to a log.

Rebuild the runtime after changing source. The existing runtime source/version fingerprint checks remain in place. Package only on the corresponding native target:

```bash
pnpm --dir desktop exec electron-builder --linux --x64 --publish never
pnpm --dir desktop exec electron-builder --linux --arm64 --publish never
pnpm --dir desktop exec electron-builder --win --x64 --publish never
pnpm --dir desktop exec electron-builder --mac --x64 --publish never
pnpm --dir desktop exec electron-builder --mac --arm64 --publish never
```

Do not run all five commands on one host and describe that as native validation.

## CI lanes and evidence boundaries

| Native runner | Architecture | Required installers | Execution evidence |
| --- | --- | --- | --- |
| `ubuntu-24.04` | x64 | AppImage, deb | Real secure C Docker integration and packaged Electron UI smoke |
| `ubuntu-24.04-arm` | arm64 | AppImage, deb | Real secure C Docker integration and packaged Electron UI smoke |
| `windows-2022` | x64 | NSIS setup exe, portable exe | Native packaging and portable tests only |
| `macos-15-intel` | x64 | dmg, zip | Native packaging and portable tests only |
| `macos-15` | arm64 | dmg, zip | Native packaging and portable tests only |

Each lane installs frozen dependencies, verifies installed versions, runs `pnpm run build:desktop`, tests/type-checks and packages with `--publish never`. Both Linux lanes additionally inspect the existing runner Docker engine, explicitly pull the pinned image, and execute `node desktop/tests/c-integration.cjs` with `BOLT_C_INTEGRATION=1`, `BOLT_C_DOCKER_PATH=/usr/bin/docker` and `BOLT_C_DOCKER_HOST=unix:///var/run/docker.sock`. Docker unavailability or failed enforcement fails the Linux lane; no privilege escalation, socket-permission relaxation or unconfined fallback is added.

Linux packaged smoke launches the actual unpacked Electron binary under Xvfb. Only the disposable packaged `chrome-sandbox` helper receives verified `root:root:4755` ownership/mode, matching the existing workflow. Chromium sandboxing must remain enabled; no `--no-sandbox`, global host-security bypass or model-driven elevation is allowed.

**Standard packaged UI smoke is not the C execution test.** It checks local UI loading and renderer/navigation policy. The C setup can be shown as unavailable in that UI without pretending the smoke ran a C program. Only the separate integration receipts establish Docker execution. Neither test, by default, establishes real AI inference. Windows/macOS packaging is not native GUI launch, Docker execution or signing certification.

Installer artifacts are named `BoltCog-C-<version>-<platform>-<arch>`. Separate `c-edition-evidence-linux-<arch>` artifacts retain engine/image metadata, integration logs and UI smoke output even after a failure, where produced. Logs preserve the integration test's own JSON records without inventing success fields. CI artifacts expire after 14 days; export the relevant receipts for durable maintainer review.

## Triggers, permissions and draft assembly

The new workflow accepts **tag pushes matching `c-desktop-v*`** and **`workflow_dispatch`** only. It intentionally has no PR/branch packaging trigger, avoiding duplication of the existing PR workflow. Manual dispatch, including dispatch on a C tag, is **artifact-only**. It cannot assemble or publish a release. A dispatch on a non-C tag is rejected by the identity check.

The workflow checks C identity and pins and compares the tag's stripped `c-desktop-v` suffix with `desktop/package.json.version` locally. It does **not** invoke or modify the shared `desktop-v*` version validator. It checks out the exact event commit, and revalidates the C tag before any release writes. All actions reuse the exact SHA pins from the existing desktop release workflow.

Only the separate `draft-release` job has `contents: write`; the workflow default and all native packaging jobs use `contents: read`. Checkouts never persist credentials, and signing secrets are not supplied. GitHub contents permission is repository-scoped, not a per-release permission: explicit tag/draft checks and narrow operations provide the additional workflow-level boundary.

Draft assembly requires **all five native build lanes to succeed**, then downloads this run's exact C-version installer groups. It requires all ten installer files, including both Windows exe targets, checks names/nonempty sizes, and writes `SHA256SUMS`. A failed or missing Linux integration, packaged smoke, application/type check or installer target blocks the draft.

A missing C release is created as a draft using `--verify-tag`. Reruns preserve existing draft notes/title and do not clobber existing assets: matching assets are read back and checked; a changed asset fails instead of silently replacing it. Published releases are rejected. No automatic publication, update-channel setup or edits to old official releases occur. A mismatched draft requires explicit maintainer review; this workflow will not delete or overwrite evidence to make a rerun pass.

Asset verification reads the actual release and numeric asset IDs, downloads each installer and `SHA256SUMS` through the asset API, and compares SHA-256 of downloaded bytes with the local files. It additionally checks state/size and an API digest when present, then rechecks the release remains a draft and asset IDs are unchanged. `c-edition-draft-readback-<run-id>-<attempt>` retains available checksum and readback JSON receipts. IDs/size alone are not treated as integrity proof. A failed read is fatal, not interpreted as an absent release.

Do not manually publish or edit assets while draft assembly runs; release checks cannot make a concurrent maintainer publication atomic. Review the final draft state and all receipts after completion.

## Maintainer release gate

Before creating the initial `c-desktop-v0.3.3` tag, validate the complete shared source and intended identity, ensure the real C integration test exists and fails correctly, and review the digest-pinned image provenance. A local syntax/actionlint result only validates workflow structure; it does not establish that hosted native builds or Docker tests ran.

After a successful tag run, review all five installers, both Linux C integration logs and source-hash/runtime/denial receipts, packaged UI evidence, and asset-byte readback. Verify an individual download, on a platform with a suitable SHA-256 tool, against `SHA256SUMS`; on Linux:

```bash
sha256sum --check SHA256SUMS --ignore-missing
```

**Installers are unsigned and macOS is not notarized.** SmartScreen/Gatekeeper warnings or blocks are expected distribution risks, not reasons for global security bypasses. Production distribution still needs native installation/launch acceptance on every target, Windows Authenticode, macOS Developer ID signing/notarization/stapling, operator Docker setup testing, storage/export acceptance, and a separately configured real AI-endpoint/model test with honest generation-quality evidence. Manual publication requires explicit maintainer approval after these gates; a draft itself is not approval.

# Bolt Cog C — C17-only coding edition

This is a separate desktop edition, not a rewrite of Electron into C. The application remains Electron/React/TypeScript, while generated projects contain only `.c` and `.h` files. The underlying real configured model remains Anthropic or an OpenAI-compatible llama.cpp/KoboldCpp endpoint. No model weights, tokenizer, neural computation or generated responses are substituted or simulated.

## Workflow

1. Open **File → Inference settings**, choose the real provider and exact supported model ID, then **Test inference connection**. Local endpoints include `http://127.0.0.1:8080/v1` for llama.cpp and `http://127.0.0.1:5001/v1` for KoboldCpp; use the model ID returned by that endpoint's `/v1/models`. Local inference binaries and GGUF files are separately installed, not included in the application.
2. Ask for a C17 implementation. The server supplies the C-only prompt, disables all shell/native inspection tools and assistant-prefill continuation, and does not let a client JSON field override that policy. The C page accepts only one complete, file-only artifact with validated `.c`/`.h` paths and exact source bytes. Invalid or partial output is rejected, not repaired into pretend model output. C edition routing does not expose the general WebContainer workbench.
3. Review/edit the source. Local quoted includes must reference an existing project header relative to the including file. All 29 C17 standard headers are available. Platform headers, C++ files, scripts, Makefiles, user compiler flags and GNU extension tokens, `_Pragma`, `__extension__`, and macro token-pasting (`##` or `%:%:`) are rejected by the conservative project screen. A real compiler remains necessary: this lexical screen is not a C parser or absolute ISO conformance proof.
4. Click **Review compile & run**, inspect the file list, SHA-256 and resource bounds, then **Run this exact source**. The server issues a 120-second one-use ticket bound to canonical exact source and stdin. Editing requires a fresh review. Source review is an explicit UI authorization, not blanket sudo.
5. Inspect the real compile and runtime receipts. Compilation uses fixed C17 compiler arguments; only a successfully compiled bounded Linux ELF enters a second fresh runtime container. Nonzero exits, compiler errors, OOM, deadlines and output overflow are not successes. `stdout` cannot forge the authoritative Docker wait/inspect exit.
6. **Send actual results to model** submits bounded receipt data as untrusted evidence. It never automatically authorizes another run; the new project must be reviewed again.

## Install the real compiler prerequisites

Install a patched Docker Engine (preferably rootless Linux) or Docker Desktop with Linux containers. The adapter does not install, pull, build or elevate anything automatically. Explicitly fetch the pinned Docker Official GCC image:

```sh
docker pull docker.io/library/gcc@sha256:5e927c284bf55a7dc796262e311a0703344f62f41f5621eb56843111b1d37e15
```

This multi-architecture digest was resolved from the official `gcc:14-bookworm` image and the actual Linux ARM64 image reported GCC14.3.0. Future image updates require a reviewed source/version change; tags are not a fallback.

The default Docker CLI is `/usr/bin/docker` on Linux, `/usr/local/bin/docker` on macOS, or `C:\Program Files\Docker\Docker\resources\bin\docker.exe` on Windows. Default daemon endpoint is `unix:///var/run/docker.sock` or `npipe:////./pipe/docker_engine`. Trusted native main-process environment overrides `BOLT_C_DOCKER_PATH` and `BOLT_C_DOCKER_HOST` can select a different absolute local CLI/socket; TCP, SSH and remote named pipes are rejected. Example rootless Linux launch:

```sh
BOLT_C_DOCKER_HOST=unix:///run/user/1000/docker.sock ./BoltCog-C-0.3.1-linux-x64.AppImage
```

Use the actual user UID and socket, not a guessed UID. Docker Desktop may require its actual local Unix socket path or Linux-engine named pipe. The CLI needs access to the selected local engine, but generated programs never receive that socket. The application uses a separate desktop app ID/user-data partition from the general edition. Re-enter inference settings there; secrets are not silently copied from the general edition. Provider keys stay in trusted processes/encrypted preferences, not renderer or container environment.

If an enforcing engine, secure image, audit path or compiler is unavailable, the adapter fails closed. There is no unsandboxed host `gcc`, shell, sudo or WebContainer fallback.

## Real isolation profile

Each job uses a compile container and separate run container. Both use UID/GID65534, network `none`, read-only root, all Linux capabilities dropped, no-new-privileges, builtin seccomp, private IPC/cgroup namespace, no host binds/devices/ports, no Docker socket, and minimal clean environment. Sources are streamed as controlled regular-file archives to root-owned readonly input tmpfs. The bounded compiled binary is transferred in memory to a separate root-owned runtime tmpfs; it is not placed in the host workspace.

| Bound | Value |
|---|---|
| Project | 1–32 `.c`/`.h` files, at least one `.c` |
| Source / stdin | 256KiB UTF-8 source / 8KiB stdin; JSON request additionally bounded |
| CPU / processes | 1 CPU; 64 PIDs |
| Memory | 512MiB compile; 256MiB run |
| Compiler deadline | 20s internal KILL limit; 25s outer |
| Program deadline | 5s internal KILL limit; 8s outer |
| Total job | 65s outer; separate bounded cleanup |
| Output / compiled ELF | 64KiB combined compile+run output; 8MiB ELF |
| Writable sandbox | Bounded tmpfs only; `/input` and `/tmp` noexec |
| Review | Exact-source/ stdin SHA-256, one-use ticket, 120s expiry |

Memory, CPU, PID and seccomp support are verified. Swap policy requires either a swap-limit controller or a fresh trusted-image probe of the Docker engine kernel proving SwapTotal0 and no swap devices. Docker may normalize MemorySwap to -1 when its controller is unavailable; this is accepted only in the fixed trusted no-user-code probe or after that probe has proved zero swap for the current preflight. Do not enable swap or alter engine security during jobs. This is not a blind missing-controller exemption or a desktop-host `/proc` assumption.

Abort, disconnect, output overflow and normal quit terminate owned containers/descendants. Docker create completes within its bounded control window before cancellation propagates, preserving the exact owned ID; info probes are cancellable. Ordinary C Quit/Restart allows a60-second cleanup window and reports nonzero or forced shutdown as unconfirmed cleanup, not success. IDs, scopes, source hash, actual exits and cleanup results are append/fsync audited without source content or keys. Cleanup uncertainty disables further compilation. A hard process/OS crash still requires operator-assisted recovery from the recorded exact IDs and labels; do not use broad `docker rm`/prune commands.

## Residual gates

Containers share the Docker engine kernel. For hostile multi-user deployments, use a disposable dedicated VM/microVM or stronger workload boundary; Docker hardening alone does not guarantee immunity to compiler/kernel escapes. Rootful Docker socket access is host-equivalent for the trusted backend; restrict it to this application/user, keep the engine/image/compiler patched, and never expose that socket to the renderer or model.

This release creates GNU/Linux sandbox executables even when Docker Desktop runs on Windows or macOS. It is not a Windows PE, macOS Mach-O, embedded firmware, GUI toolkit or unrestricted native library builder. C17 syntax can invoke dangerous standard-library or declared OS functions; safety comes from the OS boundary, not from source screening. Real mathematical correctness and algorithmic performance need source-specific tests.

Native Windows/macOS Docker execution, signing/notarization, image vulnerability review and hard-crash recovery remain separate release gates unless independently evidenced. CI model requests are not invented: unit transport fixtures, real C fixture tests and genuine neural-model tests must remain labelled separately.

See `C_EDITION_RELEASE.md` for the separate `c-desktop-v*` preview release workflow. Existing official general releases remain immutable.

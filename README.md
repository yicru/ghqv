# ghqv

[English](README.md) | [日本語](README.ja.md)

`ghqv` is a CLI that aggregates multiple independent Git repositories managed by [ghq](https://github.com/x-motemen/ghq) into a single reproducible virtual workspace. Without migrating to a real monorepo, it preserves each repository's Git history, branches, CI, and release boundaries while giving coding agents and developers cross-cutting access to source code and architecture context.

## Requirements

- macOS or Linux
- `git`
- [`ghq`](https://github.com/x-motemen/ghq)
- [`fzf`](https://github.com/junegunn/fzf) — only for `ghqv setup` repository selection

The distributed binary is a single executable built with Bun `--compile`, so users do not need Bun or Node.js installed.

## Installation

Homebrew (dedicated tap):

```bash
brew install Yicru/tap/ghqv
```

`ghq` and `fzf` are installed automatically as dependencies. To upgrade:

```bash
brew upgrade ghqv
```

Alternatively, grab a binary from the [releases](https://github.com/Yicru/ghqv/releases) and put it on your `PATH`.

## Basic usage

```bash
# Create a workspace
ghqv init myapp-vmono

# Move into it
cd "$(ghqv path myapp-vmono)"

# Register repositories across organizations
ghqv add github.com/organization-a/backend \
  --as backend \
  --role "Backend API and services" \
  --tech TypeScript Hono

ghqv add github.com/organization-b/frontend \
  --as frontend \
  --role "Web frontend" \
  --tech TypeScript React \
  --depends-on backend

# Preview the planned changes
ghqv sync --dry-run

# Apply
ghqv sync

# Inspect state
ghqv status
```

For a team-shared workspace:

```bash
ghqv clone git@github.com:organization-a/myapp-vmono.git
cd "$(ghqv path myapp-vmono)"
ghqv status
```

## Interactive setup

`ghqv setup` walks you through creating a workspace in one go: workspace name, description, then fuzzy-find repositories from your `ghq` checkout and assign a logical name, role, tech tags, and `depends_on` for each. It runs `init`, `add`, and `sync` automatically.

If Claude Code (`claude`) or Codex (`codex`) is installed, `ghqv setup` offers to infer each repository's `role` and `tech` tags from its README / manifest, pre-filled for you to confirm or edit. Detection is optional and falls back to manual entry when no AI CLI is available.

```bash
ghqv setup
```

## Commands

| Command | Description |
|---|---|
| `ghqv init <name>` | Create a workspace |
| `ghqv setup` | Interactively create a workspace and register repositories |
| `ghqv clone <url>` | Clone a shared workspace repository |
| `ghqv add <source>` | Add a repository to the manifest |
| `ghqv remove <name>` | Remove a repository from the manifest |
| `ghqv sync` | Materialize manifest repositories as symlinks |
| `ghqv status` | Show workspace state |
| `ghqv list` | List workspaces |
| `ghqv path <name>` | Print the absolute path of a workspace |
| `ghqv doctor` | Diagnose the environment and workspace |
| `ghqv config` | Manage configuration |

Global options: `-w/--workspace`, `--workspace-root`, `--json`, `--color`, `-q/--quiet`, `-v/--verbose`.

## Design

A workspace is created under `~/ghq/workspaces` (default) as an independent Git repository. Each source repository is placed into the workspace as a relative symlink that reuses the existing ghq checkout. The manifest (`.ghqv.yaml`) and generated files (`AGENTS.md`, `CLAUDE.md`, `.gitignore`) declare the desired state.

## Development

```bash
bun install
bun run dev           # run
bun test              # tests
bun run typecheck     # type check
bun run lint          # lint
bun run build         # build single-file binaries into dist/
```

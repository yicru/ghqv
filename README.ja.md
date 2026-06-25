# ghqv

[English](README.md) | [日本語](README.ja.md)

`ghqv` は、ghq が管理する複数の独立した Git リポジトリを、1つの仮想ワークスペースへ再現可能に集約する CLI です。モノレポへ移行せず、各リポジトリの Git 履歴・ブランチ・CI・リリース単位を維持したまま、コーディングエージェントや開発者へ横断的なソースコードとアーキテクチャ情報を提供します。

## 必要環境

- macOS または Linux
- `git`
- [`ghq`](https://github.com/x-motemen/ghq)
- [`fzf`](https://github.com/junegunn/fzf) — `ghqv setup` のリポジトリ選択のみで使用

配布バイナリは Bun `--compile` によるシングルバイナリのため、利用者側に Bun や Node.js は不要です。

## インストール

Homebrew 経由 (専用 tap):

```bash
brew install Yicru/tap/ghqv
```

`ghq` と `fzf` が依存として自動的にインストールされます。その後:

```bash
brew upgrade ghqv
```

または [リリース](https://github.com/Yicru/ghqv/releases)からバイナリを取得して PATH へ配置してください。

## 基本的な使い方

```bash
# ワークスペース作成
ghqv init myapp

# 移動
cd "$(ghqv path myapp)"

# repository を登録
ghqv add github.com/acme/backend \
  --as backend \
  --role "Backend API and services" \
  --tech TypeScript Hono

ghqv add github.com/acme/frontend \
  --as frontend \
  --role "Web frontend" \
  --tech TypeScript React \
  --depends-on backend

# 変更予定を確認
ghqv sync --dry-run

# 適用
ghqv sync

# 状態確認
ghqv status
```

生成される `.ghqv.yaml` は block 形式で、リストは1行表記になります:

```yaml
version: 1
workspace:
  name: myapp
  default_mode: link
  auto_get: true
repositories:
  backend:
    source: github.com/acme/backend
    role: Backend API and services
    tech:
      - TypeScript
      - Hono
  frontend:
    source: github.com/acme/frontend
    role: Web frontend
    tech:
      - TypeScript
      - React
    depends_on:
      - backend
```

チーム共有済みワークスペースの場合:

```bash
ghqv clone git@github.com:acme/myapp.git
cd "$(ghqv path myapp)"
ghqv status
```

## コマンド

| コマンド | 説明 |
|---|---|
| `ghqv init <name>` | ワークスペースを作成する |
| `ghqv setup` | 対話的にワークスペースを作成し repository を登録する |
| `ghqv clone <url>` | 共有ワークスペースリポジトリを clone する |
| `ghqv add <source>` | repository を manifest へ追加する |
| `ghqv remove <name>` | repository を manifest から削除する |
| `ghqv sync` | manifest に基づき symlink を materialize する |
| `ghqv status` | ワークスペースの状態を表示する |
| `ghqv list` | ワークスペース一覧を表示する |
| `ghqv path <name>` | ワークスペースの絶対パスを出力する |
| `ghqv doctor` | 環境とワークスペースを診断する |
| `ghqv config` | 設定を管理する |

共通オプション: `-w/--workspace`, `--workspace-root`, `--json`, `--color`, `-q/--quiet`, `-v/--verbose`。

## 設計

ワークスペースは `~/ghq/workspaces` (既定値) 配下に、独立した Git リポジトリとして作成されます。各 source repository は相対 symlink としてワークスペース内へ配置され、実体は ghq の checkout を再利用します。manifest (`.ghqv.yaml`) と生成ファイル (`AGENTS.md`, `CLAUDE.md`, `.gitignore`) が desired state を宣言します。

## 開発

```bash
bun install
bun run dev           # 実行
bun test              # テスト
bun run typecheck     # 型検査
bun run lint          # lint
bun run build         # シングルバイナリを dist/ へ生成
```

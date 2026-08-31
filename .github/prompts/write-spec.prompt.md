---
name: write-spec
description: " docs/user/draft.md の簡易仕様書をもとに、docs/agent/spec/ フォルダ内に各種仕様書を作成"
model: Claude Sonnet 4.6 (copilot)
tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'agent', 'todo']
---

# 指示内容

- `docs/user/draft.md` には最低限の機能や仕様が書かれている
- この他に実装する必要のある機能等あれば追加して、 `docs/agent/spec/` フォルダに以下の4つの仕様書を作成する
  1. 全体概要仕様書
  2. API 設計書
  3. データベース設計書
  4. UI / 画面設計書

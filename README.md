# claude-mods

自用的 Claude Code mod（plugin），任何專案都能使用。

| Plugin | 內容 |
| --- | --- |
| `session-stats` | 右側 pane「工作階段狀態」：用量與預報（context、rate limit、compact 預估）、任務與執行紀錄（可回放）、上下文與改動範圍。指令 `/session-stats` 開關 |
| `project-activity` | 「專案活動」pane（專案類型、關鍵檔案、熱門檔案、最近活動）與「Git 狀態」pane，測試結果 status line、回合摘要 band。指令 `/project-activity`、`/git-status` |

## 安裝（新的電腦）

這是私人 repository，電腦上的 git 需要能存取 GitHub（登入過即可）。在 Claude Code 的提示列輸入：

```
/plugin install session-stats --marketplace hn83320589/claude-mods
/plugin install project-activity --marketplace hn83320589/claude-mods
```

第一次會詢問是否加入 marketplace，輸入 `y`；scope 選 user（所有專案都會載入）。

## 更新

```
claude plugin marketplace update claude-mods
claude plugin update session-stats@claude-mods
claude plugin update project-activity@claude-mods
```

更新後在工作階段中執行 `/reload-plugins`。

## 開發（這台電腦）

這個資料夾本身就是 marketplace，以本機資料夾加入後，修改程式再 `/reload-plugins` 就會生效，不需要重新安裝：

```
claude plugin marketplace add ~/.claude/mods
claude plugin install session-stats@claude-mods
claude plugin install project-activity@claude-mods
```

測試與檢查：

```
claude plugin validate ./session-stats
claude plugin test ./session-stats
claude plugin validate ./project-activity
claude plugin test ./project-activity
```

## 專案設定（選用）

`project-activity` 可以在專案的 `.claude/project-activity.json` 列出要檢查的檔案（例如必要的資料檔），沒有這個檔時 pane 會提示可以設定。

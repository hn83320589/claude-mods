# claude-mods

自用的 Claude Code mod（plugin），任何專案都能使用。

| Plugin | 內容 |
| --- | --- |
| `session-stats` | 右側 pane「工作階段狀態」：用量與預報（context、rate limit、compact 預估）、任務與執行紀錄（可回放）、上下文與改動範圍。指令 `/session-stats` 開關；用量區塊有「重新整理」（快捷鍵 r） |
| `project-activity` | 「專案活動」pane（專案類型、關鍵檔案、熱門檔案、最近活動）與「Git 狀態」pane，測試結果 status line、回合摘要 band。指令 `/project-activity`、`/git-status` |

兩個 plugin 分開，是因為引擎規定用到 `$`（引擎介面）的程式必須寫在同一個檔案；合併會變成一個上千行的檔案。安裝時兩個都裝即可。

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

## Context 自動處理（session-stats）

- **門檻 80%**：每個回合結束時檢查 context 用量，達到 80% 就在回合之間先壓縮，不等引擎在工具執行到一半時才自動壓縮；畫面會顯示提示。
- **保留重點**：每次壓縮（自動、`/compact`、預先壓縮）都會要求摘要保留目前任務與進度、已做的決定與原因、改過的檔案、使用者的偏好與規則、未解決的問題。
- **摘要存檔**：壓縮產生的摘要存到專案的 `.claude/session-notes/YYYY-MM-DD-HHmm.md`。資料夾內有自己的 `.gitignore`（忽略全部），不會被提交，也不必修改專案的 `.gitignore`。
  - 只存摘要，不存原樣保留的訊息；常見的密鑰與密碼（API key、GitHub／AWS／Slack token、JWT、私鑰、`password=` 等）存檔前會遮蔽
  - `.claude`、`session-notes` 或要寫入的檔案（含 `.gitignore`）是符號連結、實際位置不在專案內，或狀態無法確認（例如權限不足）時都不存檔，避免寫到專案外

## 專案設定（選用）

`project-activity` 可以在專案的 `.claude/project-activity.json` 列出要檢查的檔案（例如必要的資料檔），沒有這個檔時 pane 會提示可以設定。

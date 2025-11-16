這是 HumanLayer Daemon (HLD)，為 WUI (humanlayer-wui) 提供動力

您無法執行此程序，也無法重新啟動它。如果您進行了變更，必須請使用者重新建置。

守護程序的日誌位於 ~/.humanlayer/logs/daemon-*.log（由 Makefile 在使用 `make daemon-dev` 或 `make daemon-nightly` 執行時建立的時間戳記檔案）

WUI 日誌（包含守護程序的 stderr 輸出）位於：
- 開發環境：`~/.humanlayer/logs/wui-{branch}/codelayer.log`
- 正式環境：平台特定的日誌目錄，例如 ~/Library/Logs/dev.humanlayer.wui.nightly/CodeLayer-Nightly.log

它使用位於 ~/.humanlayer/*.db 的資料庫 - 您可以使用 sqlite3 存取它來檢查進度和除錯。

對於正式/nightly 守護程序：
```bash
sqlite3 ~/.humanlayer/daemon.db "SELECT * FROM sessions ORDER BY created_at DESC LIMIT 5;"
```

對於開發守護程序（持久化資料庫）：
```bash
sqlite3 ~/.humanlayer/daemon-dev.db "SELECT * FROM sessions ORDER BY created_at DESC LIMIT 5;"
```

要將 nightly 資料庫複製到 dev 進行測試：
```bash
make clone-nightly-db-to-dev-db  # 備份現有的 dev 資料庫並將 nightly 複製到 dev
```

您可以使用以下指令檢查資料庫結構：
```bash
sqlite3 ~/.humanlayer/daemon.db ".schema"
sqlite3 ~/.humanlayer/daemon-dev.db ".schema"
```


根據您要查看的內容，您需要使用以下其中之一：

- `~/.humanlayer/daemon.sock`
- `~/.humanlayer/daemon-dev.sock`

如果您正在除錯程式碼變更，它們很可能在 dev socket 中。

您可以使用 nc 測試 RPC 呼叫：

```bash
echo '{"jsonrpc":"2.0","method":"getSessionLeaves","params":{},"id":1}' | nc -U SOCKET_PATH | jq '.'
```


有關測試指南和資料庫隔離要求，請參閱 TESTING.md


### Go 風格指南

- 任何非同步或長時間執行的 goroutine 都應該接受 context.Context 作為參數，並優雅地處理取消
- context 和 CancelFuncs 永遠不應該儲存在結構體上，始終作為函式的第一個參數傳遞

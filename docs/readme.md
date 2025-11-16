# Mintlify Starter Kit

點擊 `Use this template` 複製 Mintlify starter kit。starter kit 包含範例，包括

- 指南頁面
- 導覽
- 客製化
- API 參考頁面
- 使用流行元件

### 開發

安裝 [Mintlify CLI](https://www.npmjs.com/package/mintlify) 以在本機預覽文件變更。要安裝，請使用以下命令

```
npm i -g mintlify
```

在您的文件根目錄（mint.json 所在位置）執行以下命令

```
mintlify dev
```

### 發布變更

安裝我們的 Github App 以自動將變更從您的儲存庫傳播到您的部署。推送到預設分支後，變更將自動部署到生產環境。在您的儀表板上找到要安裝的連結。

#### 疑難排解

- Mintlify dev 無法執行——執行 `mintlify install` 將重新安裝相依性。
- 頁面載入為 404——確保您在包含 `mint.json` 的資料夾中執行

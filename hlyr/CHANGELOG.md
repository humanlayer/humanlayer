# 更新日誌

本文件記錄 HumanLayer CLI (hlyr) 的所有重要變更。

格式基於 [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)，
本專案遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [0.12.0] - 2025-10-07

### 新增

- 新增 `humanlayer claude init` 指令，可將 HumanLayer .claude 設定檔複製到專案中
- 使用 @clack/prompts 的互動式精靈風格使用者體驗，用於檔案選擇
- 多重選擇介面，用於選擇指令、代理和設定
- 方向鍵導航（↑↓ 移動、空白鍵切換、Enter 確認）
- `--all` 旗標，可非互動式地複製所有檔案
- `--force` 旗標，可覆寫現有的 .claude 目錄
- 自動在 .gitignore 中新增 settings.local.json 項目
- 互動式和非互動式模式的端對端測試

### 變更

- 改善使用者體驗，從基於數字的選擇改為視覺化多重選擇提示

## [0.11.0] - 2025-01-23

### 新增

- Write 工具成功模式偵測，提供更好的回饋
- 改善工作階段表格和對話檢視的使用者體驗
- 增強繼續工作階段時的標題繼承功能

### 變更

- 從工作階段啟動器中移除視覺雜訊 (ENG-1714)
- 更新網路研究說明，提供更明確的指引
- 改善 bash 允許清單設定

### 修正

- WUI 中 Edit 工具誤顯示「失敗」的問題
- 傳送新使用者訊息時工作階段標題被清除的問題 (ENG-1727)

## [0.10.0] - 先前版本

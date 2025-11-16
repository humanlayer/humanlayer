# HumanLayer SDK 文件

🚧 **注意**：本文件涵蓋的 HumanLayer SDK 正在被 CodeLayer 取代。如需最新的 IDE 體驗，請參閱主要 README。🚧

humanlayer SDK 已在 [#646](https://github.com/humanlayer/humanlayer/pull/646) 中移除

## 目錄

- [入門](#getting-started)
- [為什麼選擇 HumanLayer？](#why-humanlayer)
- [主要功能](#key-features)
- [範例](#examples)
- [路線圖](#roadmap)
- [貢獻](#contributing)
- [授權條款](#license)

## 為什麼選擇 HumanLayer？

函式和工具是[代理工作流程](https://www.deeplearning.ai/the-batch/how-agents-can-improve-llm-performance)的關鍵部分。它們使 LLM 能夠與外部世界有意義地互動，並自動化大範圍的重要工作。正確且精準的函式呼叫對於執行有意義工作的 AI 代理至關重要，例如預約、與客戶互動、管理帳單資訊、撰寫及執行程式碼等。

[![Tool Calling Loop from Louis Dupont](https://miro.medium.com/v2/resize:fit:1400/format:webp/1*r8rEqjGZs_e6dibWeaqaQg.png)](https://louis-dupont.medium.com/transforming-software-interactions-with-tool-calling-and-llms-dc39185247e9)
_來源：https://louis-dupont.medium.com/transforming-software-interactions-with-tool-calling-and-llms-dc39185247e9_

**然而**，我們能給 LLM 的最有用的函式也是風險最高的。我們都能想像 AI 資料庫管理員不斷調整和重構 SQL 資料庫的價值，但大多數團隊不會讓 LLM 對生產資料庫執行任意 SQL 語句（說實話，我們甚至大多不讓人類這麼做）。也就是說：

<div align="center">
<h3><blockquote>即使採用最先進的代理推理和提示路由，LLM 仍然不夠可靠，無法在沒有人類監督的情況下存取高風險函式</blockquote></h3>
</div>

為了更好地定義「高風險」的含義，以下是一些範例：

- **低風險**：對公開資料的讀取權限（例如搜尋維基百科、存取公開 API 和資料集）
- **低風險**：與代理作者溝通（例如工程師可能授權代理向他們發送私人 Slack 訊息以更新進度）
- **中等風險**：對私有資料的讀取權限（例如讀取電子郵件、存取行事曆、查詢 CRM）
- **中等風險**：按照嚴格規則進行溝通（例如基於特定順序的硬編碼電子郵件範本發送）
- **高風險**：代表我或代表我的公司進行溝通（例如發送電子郵件、發布到 Slack、發布社群媒體/部落格內容）
- **高風險**：對私有資料的寫入權限（例如更新 CRM 記錄、修改功能開關、更新帳單資訊）

<div align="center"><img style="width: 600px" alt="Image showing the levels of function stakes stacked on top of one another" src="./docs/images/function_stakes.png"></div>

高風險函式是最有價值的，並承諾在自動化人類工作流程方面產生最大的影響。但它們也是「90% 準確度」不被接受的函式。當今 LLM 傾向於產生幻覺或製作明顯由 AI 生成的低品質文字，這進一步影響了可靠性。團隊越早能讓代理可靠且安全地以高品質輸入呼叫這些工具，就能越早獲得巨大的好處。

HumanLayer 提供一組工具來_確定性地_保證高風險函式呼叫的人類監督。即使 LLM 犯錯或產生幻覺，HumanLayer 也內建在工具/函式本身中，保證有人類參與其中。

<div align="center"><img style="width: 400px" alt="HumanLayer @require_approval decorator wrapping the Commnicate on my behalf function" src="./docs/images/humanlayer_require_approval.png"></div>

<div align="center">
<h3><blockquote>
HumanLayer 提供一組工具來*確定性地*保證高風險函式呼叫的人類監督
</blockquote></h3>
</div>

### 未來：自主代理與「外層迴圈」

_延伸閱讀：[OpenAI 的 RealTime API 是邁向外層迴圈代理的一步](https://theouterloop.substack.com/p/openais-realtime-api-is-a-step-towards)_

在 `require_approval` 和 `human_as_tool` 之間，HumanLayer 旨在賦能下一代 AI 代理——自主代理，但這只是拼圖的一部分。為了澄清「下一代」的含義，我們可以簡要總結 LLM 應用程式的歷史。

- **第一代**：聊天——由人類發起的問答介面
- **第二代**：代理助手——框架驅動提示路由、工具呼叫、思考鏈和上下文視窗管理，以獲得更高的可靠性和功能性。大多數工作流程由人類以單次「這是任務，去執行」或滾動聊天介面的方式發起。
- **第三代**：自主代理——不再由人類發起，代理將存在於「外層迴圈」中，使用各種工具和函式朝著目標前進。人類/代理溝通是由代理發起而非人類發起。

![gen2 vs gen 3 agents](./docs/images/gen-2-gen-3-agents.png)

第三代自主代理將需要向人類諮詢各種任務的輸入。為了讓這些代理執行真正有用的工作，它們將需要對敏感操作進行人類監督。

這些代理將需要透過各種管道（包括聊天、電子郵件、簡訊等）聯繫一個或多個人類的方式。

雖然這些代理的早期版本在技術上可能是「由人類發起」的，例如透過 cron 或類似工具定期啟動，但最好的代理將管理自己的排程和成本。這將需要用於檢查成本的工具包和類似 `sleep_until` 的東西。它們需要在編排框架中執行，這些框架可以持久地序列化和恢復代理工作流程，跨越可能數小時或數天才會回傳的工具呼叫。這些框架將需要支援由「管理者 LLM」進行上下文視窗管理，並使代理能夠 fork 子鏈來處理專門的任務和角色。

這些外層迴圈代理的範例用例包括 [LinkedIn 收件匣助手](./examples/langchain/04-human_as_tool_linkedin.py) 和 [客戶引導助手](./examples/langchain/05-approvals_and_humans_composite.py)，但這實際上只是皮毛而已。

## 開發慣例

### TODO 註記

我們在整個程式碼庫中使用基於優先級的 TODO 註記系統：

- `TODO(0)`：關鍵 - 絕不合併
- `TODO(1)`：高 - 架構缺陷、重大錯誤
- `TODO(2)`：中 - 小錯誤、缺少的功能
- `TODO(3)`：低 - 潤色、測試、文件
- `TODO(4)`：需要調查的問題
- `PERF`：效能最佳化機會

## 貢獻

HumanLayer SDK 和文件是開源的，我們歡迎以 issue、文件、pull request 等形式做出貢獻。更多詳情請參閱 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 授權條款

此儲存庫中的 HumanLayer SDK 和 CodeLayer 原始碼採用 Apache 2 授權條款。

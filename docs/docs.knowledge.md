# 文件系統

## 版本控制與發布

### 發布流程

- 版本標籤遵循 semver（vX.Y.Z）
- 功能新增於主分支
- 範例與功能開發同步更新
- 為每個版本維護變更日誌
- Python 和 TypeScript 套件一起進行版本控制
- 使用 git 命令產生發布說明：
  - 使用 `git diff v0.5.11..v0.6.0` 查看版本之間的檔案變更
  - 更新 CHANGELOG.md 之前，務必從 git 查詢變更
- 變更日誌優先順序：
  - 首先記錄 API 變更，特別是新欄位和參數
  - 內部變更（測試、文件等）優先順序較低
  - 務必記錄 models.py 或 models.ts 中的新參數及其確切名稱
  - 新增功能時連結至相關文件
- 變更日誌組織：
  - 在最終發布版本中記錄功能，而非在準備/RC 版本中
  - 準備/RC 版本應有最少的變更日誌條目，指向其最終版本
  - 使用 humanlayer.dev/docs/... 格式連結至文件
  - 使用完整的 GitHub 路徑連結至範例（https://github.com/humanlayer/humanlayer/tree/main/examples/...）
- 建立新發布的步驟：
  - 在 github 中將所有程式碼合併至 main
  - 檢出 `main` 上的最新版本
  - 使用目前版本編輯 pyproject.toml 和/或 package.json，例如將 0.6.1-rc1 改為 0.6.1
  - 為 python 執行 make build-and-publish，為 ts 執行 npm publish
  - 使用發布標籤提交並標記變更，例如 v0.6.1，推送提交+標籤
  - 使用 `make update... version=0.6.1` 更新所有範例版本以使用新標籤
  - 將 pyproject 和 package.json 中的版本提升至 ${NEXT_PATCH_VERSION}-rc1

### 功能開發模式

- 新功能附帶範例
- 範例目錄按框架整合組織
- Python/TypeScript 實作之間協調變更
- Email 通道範例：主旨行、執行緒和框架特定實作

## 版本控制與發布

### 發布流程

- 版本標籤遵循 semver（vX.Y.Z）
- 功能新增於主分支
- 範例與功能開發同步更新
- 為每個版本維護變更日誌
- Python 和 TypeScript 套件一起進行版本控制

### 功能開發模式

- 新功能附帶範例
- 範例目錄按框架整合組織
- Python/TypeScript 實作之間協調變更
- Email 通道範例：主旨行、執行緒和框架特定實作

## 平台選擇

Mintlify 是選定的文件平台。它提供：

- MDX 支援互動式文件
- API 文件功能
- 本機預覽功能
- Vercel 部署整合

## 本機開發

使用以下任一方式在本機執行文件：

1. Mintlify CLI（建議）

```bash
npm i -g mintlify
mintlify dev
```

2. Docker 容器（替代方案）

```bash
# TODO: Dockerfile to be added
```

## 部署

文件透過 Vercel 整合自動部署至 docs.humanlayer.dev。

## DNS 設定

文件網站從 docs.humanlayer.dev 提供服務，設定為指向 Vercel DNS 的 CNAME 記錄。

## 品牌要求

文件使用 Humanlayer 品牌。所需資源：

- Logo 需要亮色/深色主題變體
- 圖片儲存在 docs/images/
- Logo 變體儲存在 docs/logo/
- 所有圖片必須 < 5MB

### 資源管理

建立新文件時：

- 在引用圖片之前，先將圖片從 docs-md/images/ 複製到 docs/images/
- 確保 .mdx 檔案中的圖片路徑與 docs/images/ 位置相符
- 複製前驗證圖片 < 5MB
- 對於 humanlayer.dev 上託管的圖片，使用完整 URL（例如 https://humanlayer.dev/img-approval-social.png）
- 對於本機圖片，使用來自 docs/images/ 目錄的相對路徑

該專案正在從 Metalytics 過渡到 Humanlayer 品牌——確保新文件使用 Humanlayer 資源。

## 文件結構

### 連結管理

文件連結遵循這些規則：

- 保持外部套件/工具連結（npm、pip）指向其原始來源
- 文件連結應使用 humanlayer.dev/docs/... 格式（例如 humanlayer.dev/docs/channels/email）
- 對文件頁面之間的內部導覽使用相對連結
- 範例連結應指向具有完整路徑的 GitHub 儲存庫（例如 https://github.com/humanlayer/humanlayer/tree/main/examples/langchain）
- 框架文件必須連結至範例儲存庫（https://github.com/humanlayer/humanlayer/tree/main/examples）

文件圍繞 AI 框架整合組織：

- OpenAI 整合
- Langchain 整合
- CrewAI 整合
- ControlFlow 整合（支援函式呼叫和人工核准）

框架文件的風格指南：

- 使用簡潔的標題（例如「LangChain」而非「LangChain 整合」）
- 專注於實用的真實世界範例
- 遵循一致的結構：概述、安裝、基本範例、運作原理、執行範例、後續步驟

框架整合的文件結構：

- 概述：框架和 Humanlayer 整合的簡要介紹
- 安裝：使用 pip install 命令的所需套件
- 基本範例：包含環境設定的完整可用範例
- 運作原理：範例的逐步分解
- 執行範例：執行程式碼的明確步驟
- 後續步驟：連結至核心概念（require_approval、聯絡通道等）

範例模式：

- 數學運算用於簡單示範
- 客戶入職用於真實世界使用案例

將文件重點放在框架整合模式和範例上，而非基本功能。

## 聯絡通道系統

關於聯絡通道的核心概念：

### 通道類型

- Slack：即時團隊溝通
- Email：具有執行緒的非同步通訊
- Web：用於自訂 UI 和應用程式內核准流程的 React 嵌入
  - 需要後端代理處理驗證和 API 金鑰
  - 前端元件透過後端代理通訊
  - 絕不將 HumanLayer API 金鑰暴露給前端
  - 對 Web 嵌入使用基於 JWT 的驗證：
    - 前端應傳遞編碼租戶/使用者上下文的 JWT
    - 後端在代理至 HumanLayer 之前驗證 JWT
    - 盡可能保持驗證簡單和無狀態
    - 偏好基於租戶的授權而非基於使用者的授權
  - 安全原則：
    - API 金鑰僅保留在後端
    - 前端使用短期 JWT
    - 在代理層強制執行租戶隔離
- SMS/WhatsApp：以行動裝置為主的通訊（測試版）

### 通道選擇指南

- Slack 用於團隊協作和即時核准
- Email 用於外部通訊和正式核准
- Web 嵌入用於自訂工作流程和 UI
- 行動通道用於現場作業

### 通道架構

- 通道是可組合的——可以組合用於多通道核准流程
- 每個通道都有獨特的屬性（上下文、執行緒等）
- Email 通道支援自訂 Jinja2 範本以完全控制 HTML
  - 範本變數：
    - event：完整的事件物件（函式呼叫或人工聯絡）
    - type：事件類型（「v1beta2.function_call」或「v1beta2.human_contact」）
    - urls：包含核准/回應動作的 base_url
  - 如果未提供自訂範本，則回退到預設 HTML 範本
- 實作模式：

  - Python 是主要實作語言，TypeScript/JavaScript 範例應為次要
  - 在範例中使用完整的 ContactChannel 物件，而非簡化的原始型別
  - 範例應與生產程式碼中使用的實際實作模式相符
  - 複合通道功能正在積極開發中：
    - 歡迎社群對設計提供回饋
    - 聯絡團隊參與功能開發
    - 目前方向偏好巢狀 ContactChannel 物件而非單獨的策略類型
  - 複合通道透過巢狀 ContactChannel 物件建立：

    ```python
    # Single channel
    channel = ContactChannel(slack=SlackContactChannel(...))

    # Multiple required channels
    channel = ContactChannel(all_of=[
        ContactChannel(email=EmailContactChannel(...)),
        ContactChannel(slack=SlackContactChannel(...))
    ])

    # Alternative channels
    channel = ContactChannel(any_of=[
        ContactChannel(email=EmailContactChannel(...)),
        ContactChannel(slack=SlackContactChannel(...))
    ])
    ```

- 三層級設定階層：
  1. 操作層級：透過 require_approval() 或 human_as_tool() 按函式設定
  2. SDK 層級：在 HumanLayer 實例建立時設定
  3. 專案層級：在 HumanLayer 儀表板中設定為專案預設值
- 設定優先順序遵循階層（操作覆寫 SDK，SDK 覆寫專案）
- 基於專案設定的預設通道回退

### 框架整合原則

- 為主要 Web 框架（FastAPI、Django、Express）提供一流支援
- 偏好框架特定套件而非通用實作
- React 整合功能：
  - 資料擷取和狀態管理的 Hooks 優先方法
  - 元件處理自己的驗證流程
  - 父元件中所需的最少設定
  - 盡可能在元件內部保持權杖管理

### 非同步框架整合

- 對非同步框架（FastAPI、Chainlit 等）使用 AsyncHumanLayer
- 所有 HumanLayer 方法變為非同步（create_function_call、get_function_call 等）
- 不需要 make_async 包裝器或其他非同步適配器
- 輪詢迴圈應使用框架特定的睡眠函式（例如 Chainlit 的 cl.sleep）

### Vercel AI SDK 整合

- 對工具參數使用原始 JSON schema 而非 zod
- 工具應以 OpenAI 函式格式的參數定義
- 串流回應需要來自 'ai' 的 OpenAIStream 和 StreamingTextResponse
- 工具執行應為非同步並回傳字串
- 工具定義不直接使用 zod schema，轉換為 JSON schema 格式
- 在工具呼叫期間注入訊息：

  - 使用 TransformStream 修改串流
  - 在注入的訊息周圍新增換行以實現乾淨的分離
  - 如果需要特殊處理，追蹤第一個區塊
  - 使用 TextEncoder 將訊息轉換為串流格式
  - 回傳 text-delta 類型區塊以實現適當的串流
  - 在原始區塊之後注入訊息以維持流程

- 在多個層級處理驗證：
  - 在框架特定的驗證端點中產生 JWT 權杖
  - 在 HumanLayer 儀表板中設定簽署金鑰
  - 框架特定的中介軟體和請求處理
- 每個框架整合包括：
  - 框架特定套件（例如 humanlayer-embed[fastapi]）
  - 專用請求處理程式
  - 驗證中介軟體範例
  - 盡可能使用型別安全介面

### 通道選擇指南

- Slack 用於團隊協作和即時核准
- Email 用於外部通訊和正式核准
- Web 嵌入用於自訂工作流程和 UI
- 行動通道用於現場作業

## 工具呼叫概念

關於 LLM 工具呼叫和人工監督的核心概念：

### 函式風險框架

按風險等級對函式分類：

- 低風險：對公開資料的唯讀存取
- 中風險：對私人資料的唯讀存取、範本化通訊
- 高風險：對系統的寫入存取、代表使用者/公司的自由形式通訊

### 人工監督理念

- 即使使用進階 LLM，高風險函式也需要人工監督
- 對於關鍵操作，90% 的準確率是不夠的
- 監督必須是確定性的，而非概率性的
- 人工回饋可用於評估/微調

### LLM 應用程式演進

記錄 LLM 應用程式的進展：

- 第一代：聊天——人工發起的問答介面
- 第二代：代理助理——框架驅動提示路由、工具呼叫、思考鏈和上下文視窗管理。大多數工作流程由人類在單次「這是任務，去做」或滾動聊天介面中發起。
- 第三代：自主代理——不再由人類發起，代理存在於「外部迴圈」中，使用各種工具和函式朝著目標前進。人類/代理通訊由代理發起，而非由人類發起。

#### 自主代理需求

第三代自主代理需要：

- 向人類諮詢各種任務輸入的方式
- 對敏感操作的人工監督
- 跨聊天、email、簡訊等的聯絡通道
- 自我管理的排程和成本管理
- 跨長時間執行的工具呼叫的工作流程持久化序列化和恢復
- 由「管理 LLM」進行上下文視窗管理
- 為專業任務和角色分叉子鏈的能力

使用案例範例：

- LinkedIn 收件箱助理
- 客戶入職助理

## 回應選項模式

結構化回應選項的常見模式：

- 偵測使用者挫折/情緒——使用回應選項指導代理對情緒狀態的回應
- 核准流程——提供包含描述的明確核准/拒絕選項
- 引導回應——使用回應選項將人工回饋結構化為可操作的格式
- 多步驟工作流程——在多個人工互動中鏈結回應選項

範例：偵測使用者挫折時，提供以下回應選項：

- 承認情緒（「使用者聽起來很沮喪」）
- 建議具體的後續步驟（「提供折扣」、「升級給經理」）
- 在描述中包含上下文

## 核心架構

### Run ID 和 Call ID

- Run ID 追蹤單一代理執行/對話
- Call ID 唯一識別個別函式呼叫或人工聯絡
- 階層：一個 run 可以有多個 call
- Run ID 幫助分組相關的核准/聯絡
- Call ID 啟用追蹤個別請求狀態
- 兩個 ID 都用於：
  - 稽核軌跡
  - 狀態查詢
  - 回應路由
  - 請求去重
  - 儀表板組織

## 文件風格

### TypeScript 建構子模式

在 TypeScript 中，務必使用 `humanlayer()` 函式而非 `new HumanLayer()`：

```typescript
// Preferred
import { humanlayer } from "humanlayer";
const hl = humanlayer({ runId: "my-agent" });

// Avoid
import { HumanLayer } from "humanlayer";
const hl = new HumanLayer({ runId: "my-agent" });
```

文件應遵循這些原則：

- 使用精確的技術術語（例如「HumanLayer SDK」而非只是「HumanLayer」）
- 提供可以複製貼上的完整可用範例
- 在範例中包含成功路徑和錯誤處理
- 顯示非同步操作的完整上下文（輪詢、webhook 等）
- 區分 SDK 操作和後端操作
- 在所有文件中使用一致的術語

## 社群

- 透過 Discord 進行主要社群互動
- 文件應連結至 Discord 以獲得社群支援
- GitHub 儲存庫作為次要社群中心

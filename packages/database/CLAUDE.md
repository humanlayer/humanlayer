
預設使用 Bun 而非 Node.js。

- 使用 `bun <file>` 而非 `node <file>` 或 `ts-node <file>`
- 使用 `bun test` 而非 `jest` 或 `vitest`
- 使用 `bun build <file.html|file.ts|file.css>` 而非 `webpack` 或 `esbuild`
- 使用 `bun install` 而非 `npm install` 或 `yarn install` 或 `pnpm install`
- 使用 `bun run <script>` 而非 `npm run <script>` 或 `yarn run <script>` 或 `pnpm run <script>`
- Bun 會自動載入 .env，因此不需要使用 dotenv。

## APIs

- `Bun.serve()` 支援 WebSockets、HTTPS 和路由。不要使用 `express`。
- `bun:sqlite` 用於 SQLite。不要使用 `better-sqlite3`。
- `Bun.redis` 用於 Redis。不要使用 `ioredis`。
- `Bun.sql` 用於 Postgres。不要使用 `pg` 或 `postgres.js`。
- `WebSocket` 為內建功能。不要使用 `ws`。
- 優先使用 `Bun.file` 而非 `node:fs` 的 readFile/writeFile
- 使用 Bun.$`ls` 而非 execa。

## Testing

使用 `bun test` 執行測試。

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

搭配 `Bun.serve()` 使用 HTML imports。不要使用 `vite`。HTML imports 完全支援 React、CSS、Tailwind。

伺服器端：

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML 檔案可以直接匯入 .tsx、.jsx 或 .js 檔案，Bun 的打包工具會自動進行轉譯和打包。`<link>` 標籤可以指向樣式表，Bun 的 CSS 打包工具會進行打包。

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

搭配以下 `frontend.tsx`：

```tsx#frontend.tsx
import React from "react";

// import .css files directly and it works
import './index.css';

import { createRoot } from "react-dom/client";

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

接著，執行 index.ts

```sh
bun --hot ./index.ts
```

更多資訊請參閱 `node_modules/bun-types/docs/**.md` 中的 Bun API 文件。

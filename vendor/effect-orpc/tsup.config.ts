import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/node.ts"],
  sourcemap: true,
  clean: true,
  format: "esm",
});

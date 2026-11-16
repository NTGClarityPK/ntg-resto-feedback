import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { target: "es2020", cssCodeSplit: false },
  // npm run receipts rewrites this file. Without this, every write force-reloads
  // every open page, including the app on a phone in the middle of a scan.
  server: { watch: { ignored: ["**/test-receipts.html"] } },
});

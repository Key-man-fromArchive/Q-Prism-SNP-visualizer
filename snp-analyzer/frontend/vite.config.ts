import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const base = process.env.VITE_APP_BASE_PATH || "/";
const backendTarget = process.env.VITE_DEV_API_TARGET || "http://localhost:8002";
const prefixApiPath = `${base.replace(/\/+$/, "")}/api`;
const apiProxy = {
  "/api": {
    target: backendTarget,
    changeOrigin: true,
  },
  ...(prefixApiPath === "/api"
    ? {}
    : {
        [prefixApiPath]: {
          target: backendTarget,
          changeOrigin: true,
          rewrite: (proxyPath: string) => proxyPath.replace(prefixApiPath, "/api"),
        },
      }),
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: apiProxy,
  },
  build: {
    outDir: "../app/static-react",
    emptyOutDir: true,
  },
});

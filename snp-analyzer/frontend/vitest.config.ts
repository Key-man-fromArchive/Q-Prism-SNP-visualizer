import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/test/**", "src/types/**", "src/vite-env.d.ts"],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: process.env.UX_COVERAGE_DIR || "./node_modules/.cache/ux-coverage",
      // Baseline reporting is not a gate. Per-task thresholds are passed
      // explicitly for the implemented targets listed in the manifest.
    },
  },
});

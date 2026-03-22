import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@", replacement: resolve(__dirname, "src") },
      { find: "react/jsx-runtime", replacement: "preact/jsx-runtime" },
      { find: "react-dom/test-utils", replacement: "preact/test-utils" },
      { find: "react-dom", replacement: "preact/compat" },
      { find: "react", replacement: "preact/compat" },
    ],
  },
  build: {
    outDir: resolve(__dirname, "../static/chat-island"),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, "src/chat-chrome.tsx"),
      name: "RemoteLabChatChrome",
      formats: ["iife"],
      fileName: () => "chat-chrome.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: "chat-chrome.css",
      },
    },
  },
});

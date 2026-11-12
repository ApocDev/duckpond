import { defineConfig, lazyPlugins, loadEnv } from "vite-plus";
import { nitro } from "nitro/vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const config = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "DUCKPOND_");
  for (const [key, value] of Object.entries(env)) process.env[key] ??= value;
  return {
    server: { allowedHosts: (process.env.DUCKPOND_ALLOWED_HOSTS ?? "").split(",").filter(Boolean) },
    fmt: { ignorePatterns: ["src/routeTree.gen.ts"] },
    lint: {
      jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
      rules: { "vite-plus/prefer-vite-plus-imports": "error" },
      options: { typeAware: true, typeCheck: true },
    },
    resolve: { tsconfigPaths: true },
    plugins: lazyPlugins(() =>
      mode === "test" ? [] : [tailwindcss(), tanstackStart(), nitro(), viteReact()],
    ),
  };
});

export default config;

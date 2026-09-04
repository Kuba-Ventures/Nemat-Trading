import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

/**
 * PORT only means anything to the dev server and the preview server. Validating
 * it at module scope meant the check also ran for `vite build`, which writes
 * files and never binds a port, so `pnpm run build` from the repo root failed
 * here for everyone. The guards now live inside the config factory and run only
 * for the command that actually needs them.
 */
function resolvePort(): number {
  const rawPort = process.env.PORT;

  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  return port;
}

export default defineConfig(async ({ command }): Promise<UserConfig> => {
  // "build" writes to disk; "serve" covers both `vite dev` and `vite preview`,
  // which are the two that bind a port.
  const port = command === "serve" ? resolvePort() : undefined;

  // BASE_PATH does affect the build, since it rewrites asset URLs. It stays
  // optional rather than fatal: no build has ever succeeded without it, so a
  // default cannot regress one, and falling back to Vite's own "/" keeps the
  // repo-root build working. A deploy that needs a different base gets a
  // warning rather than silence.
  const basePath = process.env.BASE_PATH;
  if (!basePath && command === "build") {
    console.warn(
      "[mockup-sandbox] BASE_PATH is not set; building with base \"/\". " +
        "Set BASE_PATH if this build is served from a subpath.",
    );
  }

  return {
  base: basePath ?? "/",
  plugins: [
    mockupPreviewPlugin(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
  };
});

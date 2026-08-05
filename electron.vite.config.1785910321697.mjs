// electron.vite.config.ts
import path, { resolve } from "node:path";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { visualizer } from "rollup-plugin-visualizer";

// release/app/package.json
var package_default = {
  name: "xyz.chatboxapp.ce",
  productName: "xyz.chatboxapp.ce",
  version: "1.22.1",
  description: "A desktop client for multiple cutting-edge AI models",
  author: {
    name: "Mediocre Company",
    email: "hi@chatboxai.com",
    url: "https://github.com/chatboxai"
  },
  main: "./dist/main/main.js",
  scripts: {
    rebuild: "node ../../.erb/scripts/electron-rebuild.cjs",
    postinstall: "pnpm run rebuild && pnpm run link-modules && node ../../.erb/scripts/patch-libsql.cjs",
    "link-modules": "node ../../.erb/scripts/link-modules.cjs"
  },
  dependencies: {
    "@anthropic-ai/sandbox-runtime": "^0.0.54",
    "@libsql/client": "^0.15.6"
  }
};

// electron.vite.config.ts
var __electron_vite_injected_dirname = "D:\\chatbox-public\\chatbox";
function injectBaseTag() {
  return {
    name: "inject-base-tag",
    transformIndexHtml() {
      return [
        {
          tag: "base",
          attrs: { href: "/" },
          injectTo: "head-prepend"
          // Inject at the beginning of <head>
        }
      ];
    }
  };
}
function injectReleaseDate() {
  const releaseDate = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return {
    name: "inject-release-date",
    transformIndexHtml() {
      return [
        {
          tag: "script",
          children: `window.chatbox_release_date="${releaseDate}";`,
          injectTo: "head-prepend"
        }
      ];
    }
  };
}
function replacePlausibleDomain() {
  return {
    name: "replace-plausible-domain",
    transformIndexHtml(html) {
      return html.replace('data-domain="app.chatboxai.app"', 'data-domain="web.chatboxai.app"');
    }
  };
}
function injectViewportContent(isDesktop) {
  const content = isDesktop ? "width=device-width, initial-scale=1, user-scalable=no" : "height=device-height, width=device-width, initial-scale=1, user-scalable=no, viewport-fit=cover";
  return {
    name: "inject-viewport-content",
    transformIndexHtml(html) {
      return html.replace("%VIEWPORT_CONTENT%", content);
    }
  };
}
function dvhToVh() {
  return {
    name: "dvh-to-vh",
    transform(code, id) {
      if (id.endsWith(".css") || id.endsWith(".scss") || id.endsWith(".sass")) {
        return {
          code: code.replace(/(\d+)dvh/g, "$1vh"),
          map: null
        };
      }
      return null;
    }
  };
}
var inferredRelease = process.env.SENTRY_RELEASE || package_default.version;
var inferredDist = process.env.SENTRY_DIST || void 0;
process.env.SENTRY_RELEASE = inferredRelease;
if (inferredDist) {
  process.env.SENTRY_DIST = inferredDist;
}
var electron_vite_config_default = defineConfig(({ mode }) => {
  const isProduction = mode === "production";
  const isWeb = process.env.CHATBOX_BUILD_PLATFORM === "web";
  const isMobile = process.env.CHATBOX_BUILD_TARGET === "mobile_app";
  const isDesktop = !isWeb && !isMobile;
  return {
    main: {
      plugins: [
        ...isProduction ? [
          visualizer({
            filename: "release/app/dist/main/stats.html",
            open: false,
            title: "Main Process Dependency Analysis"
          })
        ] : [externalizeDepsPlugin()],
        process.env.SENTRY_AUTH_TOKEN ? sentryVitePlugin({
          authToken: process.env.SENTRY_AUTH_TOKEN,
          org: "sentry",
          project: "chatbox",
          url: "https://sentry.midway.run/",
          release: {
            name: inferredRelease,
            ...inferredDist ? { dist: inferredDist } : {}
          },
          sourcemaps: {
            assets: isProduction ? "release/app/dist/main/**" : "output/main/**"
          },
          telemetry: false
        }) : void 0
      ].filter(Boolean),
      build: {
        outDir: isProduction ? "release/app/dist/main" : void 0,
        lib: {
          entry: resolve(__electron_vite_injected_dirname, "src/main/main.ts")
        },
        sourcemap: isProduction ? "hidden" : true,
        minify: isProduction,
        rollupOptions: {
          external: Object.keys(package_default.dependencies || {}),
          output: {
            entryFileNames: "[name].js",
            inlineDynamicImports: true
          }
        }
      },
      resolve: {
        alias: {
          "@": path.resolve(__electron_vite_injected_dirname, "./src/renderer"),
          "@shared": path.resolve(__electron_vite_injected_dirname, "./src/shared"),
          "src/shared": path.resolve(__electron_vite_injected_dirname, "./src/shared")
        }
      },
      define: {
        "process.type": '"browser"',
        "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
        "process.env.CHATBOX_BUILD_TARGET": JSON.stringify(process.env.CHATBOX_BUILD_TARGET || "unknown"),
        "process.env.CHATBOX_BUILD_PLATFORM": JSON.stringify(process.env.CHATBOX_BUILD_PLATFORM || "unknown"),
        "process.env.CHATBOX_BUILD_CHANNEL": JSON.stringify(process.env.CHATBOX_BUILD_CHANNEL || "unknown"),
        "process.env.USE_LOCAL_API": JSON.stringify(process.env.USE_LOCAL_API || ""),
        "process.env.USE_BETA_API": JSON.stringify(process.env.USE_BETA_API || ""),
        "process.env.USE_NEWDB_API": JSON.stringify(process.env.USE_NEWDB_API || ""),
        "process.env.USE_LOCAL_CHATBOX": JSON.stringify(process.env.USE_LOCAL_CHATBOX || ""),
        "process.env.USE_BETA_CHATBOX": JSON.stringify(process.env.USE_BETA_CHATBOX || "")
      }
    },
    preload: {
      plugins: [
        visualizer({
          filename: "release/app/dist/preload/stats.html",
          open: false,
          title: "Preload Process Dependency Analysis"
        })
      ],
      build: {
        outDir: isProduction ? "release/app/dist/preload" : void 0,
        lib: {
          entry: resolve(__electron_vite_injected_dirname, "src/preload/index.ts")
        },
        sourcemap: isProduction ? "hidden" : true,
        minify: isProduction
      },
      resolve: {
        alias: {
          "@": path.resolve(__electron_vite_injected_dirname, "./src/renderer"),
          "@shared": path.resolve(__electron_vite_injected_dirname, "./src/shared"),
          "src/shared": path.resolve(__electron_vite_injected_dirname, "./src/shared")
        }
      }
    },
    renderer: {
      resolve: {
        alias: {
          "@": path.resolve(__electron_vite_injected_dirname, "src/renderer"),
          "@shared": path.resolve(__electron_vite_injected_dirname, "src/shared")
        }
      },
      plugins: [
        TanStackRouterVite({
          target: "react",
          autoCodeSplitting: true,
          routesDirectory: "./src/renderer/routes",
          generatedRouteTree: "./src/renderer/routeTree.gen.ts"
        }),
        react({}),
        dvhToVh(),
        injectViewportContent(isDesktop),
        isWeb ? injectBaseTag() : void 0,
        injectReleaseDate(),
        isWeb ? replacePlausibleDomain() : void 0,
        visualizer({
          filename: "release/app/dist/renderer/stats.html",
          open: false,
          title: "Renderer Process Dependency Analysis"
        }),
        process.env.SENTRY_AUTH_TOKEN ? sentryVitePlugin({
          authToken: process.env.SENTRY_AUTH_TOKEN,
          org: "sentry",
          project: "chatbox",
          url: "https://sentry.midway.run/",
          release: {
            name: inferredRelease,
            ...inferredDist ? { dist: inferredDist } : {}
          },
          sourcemaps: {
            assets: isProduction ? "release/app/dist/renderer/**" : "output/renderer/**"
          },
          telemetry: false
        }) : void 0
      ].filter(Boolean),
      build: {
        outDir: isProduction ? "release/app/dist/renderer" : void 0,
        target: "es2020",
        // Avoid static initialization blocks for browser compatibility
        sourcemap: isProduction ? "hidden" : true,
        minify: isProduction ? "esbuild" : false,
        // Use esbuild for faster, less memory-intensive minification
        rollupOptions: {
          output: {
            entryFileNames: "js/[name].[hash].js",
            chunkFileNames: "js/[name].[hash].js",
            assetFileNames: (assetInfo) => {
              if (assetInfo.name?.endsWith(".css")) {
                return "styles/[name].[hash][extname]";
              }
              if (/\.(woff|woff2|eot|ttf|otf)$/i.test(assetInfo.name || "")) {
                return "fonts/[name].[hash][extname]";
              }
              if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(assetInfo.name || "")) {
                return "images/[name].[hash][extname]";
              }
              return "assets/[name].[hash][extname]";
            },
            // Optimize chunk splitting to reduce memory usage during build
            manualChunks(id) {
              const normalizedId = id.split(path.sep).join("/");
              const isNodeModulePackage = (pkg) => normalizedId.includes(`/node_modules/${pkg}/`);
              if (normalizedId.includes("src/renderer/stores/session/") || normalizedId.includes("src/renderer/stores/sessionActions")) {
                return "stores-session";
              }
              if (normalizedId.includes("src/renderer/packages/context-management/")) {
                return "context-management";
              }
              if (normalizedId.includes("/node_modules/")) {
                if (isNodeModulePackage("@ai-sdk") || isNodeModulePackage("ai")) {
                  return "vendor-ai";
                }
                if (isNodeModulePackage("@mantine") || isNodeModulePackage("@tabler")) {
                  return "vendor-ui";
                }
                if (isNodeModulePackage("d3") || /\/node_modules\/d3-[^/]+\//.test(normalizedId)) {
                  return "vendor-charts";
                }
              }
            }
          }
        }
      },
      css: {
        modules: {
          generateScopedName: "[name]__[local]___[hash:base64:5]"
        },
        postcss: "./postcss.config.cjs"
      },
      server: {
        port: Number(process.env.DEV_PORT) || 1212,
        watch: {
          // The root .env is a 1Password-managed FIFO in local development. Vite
          // treats env file changes as a full server restart, which can interrupt
          // dependency scanning during startup and print noisy dep-scan failures.
          ignored: ["**/.env", "**/.env.*"]
        }
      },
      define: {
        "process.type": '"renderer"',
        "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
        "process.env.CHATBOX_BUILD_TARGET": JSON.stringify(process.env.CHATBOX_BUILD_TARGET || "unknown"),
        "process.env.CHATBOX_BUILD_PLATFORM": JSON.stringify(process.env.CHATBOX_BUILD_PLATFORM || "unknown"),
        "process.env.CHATBOX_BUILD_CHANNEL": JSON.stringify(process.env.CHATBOX_BUILD_CHANNEL || "unknown"),
        "process.env.USE_LOCAL_API": JSON.stringify(process.env.USE_LOCAL_API || ""),
        "process.env.USE_BETA_API": JSON.stringify(process.env.USE_BETA_API || ""),
        "process.env.USE_NEWDB_API": JSON.stringify(process.env.USE_NEWDB_API || ""),
        "process.env.USE_LOCAL_CHATBOX": JSON.stringify(process.env.USE_LOCAL_CHATBOX || ""),
        "process.env.USE_BETA_CHATBOX": JSON.stringify(process.env.USE_BETA_CHATBOX || "")
      },
      optimizeDeps: {
        // Force a fresh dep optimization on dev startup. This avoids stale .vite
        // cache artifacts that intermittently break MUI internals after branch or
        // dependency changes with runtime errors like "createTheme_default is not a function".
        force: true,
        include: ["mermaid"],
        esbuildOptions: {
          target: "es2015"
        }
      }
    }
  };
});
export {
  electron_vite_config_default as default,
  dvhToVh,
  injectBaseTag,
  injectReleaseDate,
  injectViewportContent,
  replacePlausibleDomain
};

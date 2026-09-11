import { defineConfig } from "vite";
import vinext from "vinext";
import { nitro } from "nitro/vite";

// The local preview retains its Cloudflare config. Vercel needs Nitro's
// serverless output rather than the Cloudflare Worker in dist/server.
export default defineConfig({
  plugins: [
    vinext(),
    nitro({
      preset: "vercel",
      vercel: {
        functions: { runtime: "nodejs24.x" },
      },
    }),
  ],
});

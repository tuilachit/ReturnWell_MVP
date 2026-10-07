import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { Readable } from "node:stream";
import { chromium, expect } from "@playwright/test";
test(
  "built Vercel HTML uses nonces and hydrates under enforced production CSP",
  { skip: process.env.RW_PRODUCTION_BROWSER !== "1" },
  async () => {
    const { default: app } =
      await import("../.vercel/output/functions/__server.func/index.mjs");
    const root = resolve(".vercel/output/static");
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://127.0.0.1"),
          path = resolve(root, "." + decodeURIComponent(url.pathname));
        if (
          path.startsWith(root + "/") &&
          (await stat(path).catch(() => null))?.isFile()
        ) {
          const types = {
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".json": "application/json",
          };
          res.setHeader(
            "content-type",
            types[extname(path)] ?? "application/octet-stream",
          );
          res.end(await readFile(path));
          return;
        }
        const response = await app.fetch(
          new Request(url, { headers: req.headers }),
        );
        res.writeHead(response.status, Object.fromEntries(response.headers));
        if (response.body) Readable.fromWeb(response.body).pipe(res);
        else res.end();
      } catch {
        res.writeHead(500);
        res.end("Local preview unavailable");
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const origin = "http://127.0.0.1:" + server.address().port;
      await page.route("**/*", (route) =>
        new URL(route.request().url()).hostname === "127.0.0.1"
          ? route.continue()
          : route.abort(),
      );
      const response = await page.goto(origin);
      const html = await response.text();
      assert.match(
        html.split("</head>")[0],
        /<meta name="google-site-verification" content="tGVKFHBM9n1PiwnCJ2Jf6t0PV24RCDXcuk0XYBDEEfU"\s*\/?\s*>/,
      );
      const headers = response.headers();
      assert.match(
        headers["content-security-policy"] ?? "",
        /'nonce-[a-f0-9]{48}'/,
      );
      assert.doesNotMatch(
        headers["content-security-policy"]
          .split("script-src ")[1]
          .split(";")[0],
        /unsafe-inline|unsafe-eval/,
      );
      assert.equal(headers["cache-control"], "no-store");
      await page
        .getByRole("heading", { name: "Welcome to ReturnWell" })
        .waitFor();
      if (process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED !== "true") {
        assert.equal(await page.getByRole("button", { name: "Continue with Google", exact: true }).isDisabled(), true);
      }
      await expect(page.getByLabel("Work email", { exact: true })).toBeEnabled();
      await page.getByLabel("Work email", { exact: true }).fill("fictional-entry@example.test");
      await expect(page.getByLabel("Work email", { exact: true })).toHaveValue("fictional-entry@example.test");
      assert.equal(await page.getByRole("button", { name: /preview|explore|demo/i }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "New referral", exact: true }).count(), 0);
      assert.equal(
        await page.evaluate(
          () =>
            document.querySelectorAll("script:not([src]):not([nonce])").length,
        ),
        0,
      );
      await page.goto(origin + "/auth/google?error=access_denied&error_description=PRIVATE_GOOGLE_DETAIL");
      await page.getByRole("alert").waitFor();
      assert.match(await page.getByRole("alert").innerText(), /cancelled/);
      assert.equal(page.url(), origin + "/auth/google");
      assert.doesNotMatch(await page.locator("body").innerText(), /PRIVATE_GOOGLE_DETAIL/);
      await page.getByRole("link", { name: "Use email instead" }).click();
      await page.getByLabel("Work email", { exact: true }).waitFor();
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "vite";
import { parse as parseYaml } from "yaml";
import { ROOT } from "./helpers";
import { BANNED, blurredShadows } from "./theme-util";

const APP = join(ROOT, "app");
let out = "";
let html = "";
const assets: string[] = [];

function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p, base) : [p.slice(base.length + 1)];
  });
}

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "necromancer-dist-"));
  await build({
    root: APP,
    configFile: join(APP, "vite.config.ts"),
    logLevel: "silent",
    build: { outDir: out, emptyOutDir: true },
  });
  html = readFileSync(join(out, "index.html"), "utf8");
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) assets.push(m[1]);
}, 120_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

describe("production build", () => {
  it("index.html has only relative URLs and no http URL", () => {
    expect(html).not.toMatch(/(?:src|href)="\//);
    expect(html).not.toMatch(/https?:\/\//);
    expect(assets.length).toBeGreaterThanOrEqual(2);
    for (const a of assets) expect(a.startsWith("./"), a).toBe(true);
  });

  it("every asset the page references exists in the output", () => {
    for (const a of assets) expect(existsSync(join(out, normalize(a))), a).toBe(true);
  });

  it("keeps the Content-Security-Policy that forbids connections", () => {
    expect(html).toContain("connect-src 'none'");
  });

  it("the built CSS has no remote URL and passes the theme checks", () => {
    const cssFiles = listFiles(out).filter((f) => f.endsWith(".css"));
    expect(cssFiles.length).toBeGreaterThan(0);
    for (const f of cssFiles) {
      const css = readFileSync(join(out, f), "utf8");
      expect(css).not.toMatch(/https?:\/\//);
      for (const [label, re] of BANNED) expect(re.test(css), `${label} in ${f}`).toBe(false);
      expect(blurredShadows(css)).toEqual([]);
    }
  });

  it("the total gzip size is under 600 KB", () => {
    const total = listFiles(out).reduce((n, f) => n + gzipSync(readFileSync(join(out, f))).length, 0);
    console.log(`build: total gzip ${(total / 1024).toFixed(1)} KB over ${listFiles(out).length} files`);
    expect(total).toBeLessThan(600 * 1024);
  });
});

describe("served under a sub-path", () => {
  let server: Server;
  let origin = "";
  const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const prefix = "/vba-necromancer/";
      const path = decodeURIComponent((req.url ?? "").split("?")[0]);
      if (!path.startsWith(prefix)) {
        res.writeHead(404).end();
        return;
      }
      const rel = normalize(path.slice(prefix.length) || "index.html");
      const file = join(out, rel);
      if (rel.startsWith("..") || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("serves index.html and every asset it references", async () => {
    const base = new URL("/vba-necromancer/", origin);
    const page = await fetch(base);
    expect(page.status).toBe(200);
    for (const a of assets) {
      const res = await fetch(new URL(a, base));
      expect(res.status, a).toBe(200);
    }
    expect((await fetch(new URL("/assets/missing.js", origin))).status).toBe(404);
  });
});

describe("deploy workflow", () => {
  it("parses as YAML and uploads app/dist as the Pages artifact", () => {
    const text = readFileSync(join(ROOT, "docs/ci/pages.yml"), "utf8");
    const doc = parseYaml(text) as { jobs: Record<string, { steps?: Array<{ uses?: string; with?: { path?: string }; run?: string }> }> };
    const steps = Object.values(doc.jobs).flatMap((j) => j.steps ?? []);
    const upload = steps.find((s) => s.uses?.startsWith("actions/upload-pages-artifact"));
    expect(upload?.with?.path).toBe("app/dist");
    expect(steps.some((s) => s.uses?.startsWith("actions/deploy-pages"))).toBe(true);
    const runs = steps.map((s) => s.run ?? "");
    for (const cmd of ["npm ci", "npm run typecheck", "npm test", "npm run build -w app"]) expect(runs).toContain(cmd);
  });
});

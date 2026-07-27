import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";

await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");

const staticAssets = {
  "/index.html": {
    contentType: "text/html; charset=utf-8",
    body: await readFile("dist/index.html", "utf8"),
  },
};

for (const fileName of await readdir("dist/assets")) {
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  staticAssets[`/assets/${fileName}`] = {
    contentType:
      extension === "css"
        ? "text/css; charset=utf-8"
        : extension === "js"
          ? "text/javascript; charset=utf-8"
          : "application/octet-stream",
    body: await readFile(`dist/assets/${fileName}`, "utf8"),
  };
}

await writeFile(
  "dist/server/index.js",
  `const STATIC_ASSETS = ${JSON.stringify(staticAssets)};

function serveStatic(pathname) {
  const key = pathname === "/" ? "/index.html" : pathname;
  const asset = STATIC_ASSETS[key] || (
    pathname.startsWith("/api/") ? null : STATIC_ASSETS["/index.html"]
  );
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(asset.body, {
    status: 200,
    headers: {
      "content-type": asset.contentType,
      "cache-control": key.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    },
  });
}

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === "/api/dashboard") {
      if (!env.APPS_SCRIPT_URL) {
        return Response.json(
          { ok: false, error: "Dashboard data source is not configured" },
          { status: 500 }
        );
      }
      const upstreamUrl = new URL(env.APPS_SCRIPT_URL);
      requestUrl.searchParams.forEach((value, key) => {
        upstreamUrl.searchParams.set(key, value);
      });
      const upstream = await fetch(upstreamUrl.toString(), {
        redirect: "follow",
        cache: "no-store",
      });
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
    return serveStatic(requestUrl.pathname);
  },
};
`,
);

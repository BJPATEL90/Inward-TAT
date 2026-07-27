import { copyFile, mkdir, writeFile } from "node:fs/promises";

await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
await writeFile(
  "dist/server/index.js",
  `export default {
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
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;
    return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
  },
};
`,
);

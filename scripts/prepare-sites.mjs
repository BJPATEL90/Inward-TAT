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

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function authenticateGoogle(request, env) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!token) return { ok: false, error: "Google sign-in required" };
  if (!env.GOOGLE_CLIENT_ID) {
    return { ok: false, error: "Google OAuth is not configured" };
  }

  const response = await fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token),
    { cache: "no-store" }
  );
  if (!response.ok) return { ok: false, error: "Google session is invalid or expired" };

  const claims = await response.json();
  const domain = String(env.GOOGLE_WORKSPACE_DOMAIN || "").toLowerCase();
  const emailVerified = claims.email_verified === true || claims.email_verified === "true";
  if (
    claims.aud !== env.GOOGLE_CLIENT_ID ||
    !emailVerified ||
    Number(claims.exp || 0) <= Math.floor(Date.now() / 1000) ||
    (domain && String(claims.hd || "").toLowerCase() !== domain)
  ) {
    return { ok: false, error: "Use an authorized Mosaic Wellness Google account" };
  }

  return {
    ok: true,
    user: {
      email: claims.email,
      name: claims.name || claims.email,
      picture: claims.picture || "",
      domain: claims.hd || "",
    },
  };
}

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
    if (requestUrl.pathname === "/api/auth/config") {
      if (!env.GOOGLE_CLIENT_ID) {
        return json({ ok: false, error: "Google OAuth is not configured" }, 500);
      }
      return json({
        ok: true,
        clientId: env.GOOGLE_CLIENT_ID,
        domain: env.GOOGLE_WORKSPACE_DOMAIN || "mosaicwellness.in",
      });
    }
    if (requestUrl.pathname === "/api/auth/verify") {
      const auth = await authenticateGoogle(request, env);
      return auth.ok ? json(auth) : json(auth, 401);
    }
    if (requestUrl.pathname === "/api/dashboard") {
      const auth = await authenticateGoogle(request, env);
      if (!auth.ok) return json(auth, 401);
      if (!env.APPS_SCRIPT_URL) {
        return json(
          { ok: false, error: "Dashboard data source is not configured" },
          500
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

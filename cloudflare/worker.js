export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const password = env?.BASIC_AUTH_PASSWORD || "";

    if (!password) {
      return new Response("Server misconfigured", { status: 500 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    const authHeader = request.headers.get("Authorization") || "";
    const expected = "Basic " + btoa(`user:${password}`);

    if (authHeader !== expected) {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Restricted"',
        },
      });
    }

    // Proxy to GitHub Pages or your custom domain origin
    const upstream = "https://wangzhen-ryan.github.io/SmartElectricity/";
    const targetUrl = upstream + url.pathname.replace(/^\\//, "");
    return fetch(targetUrl, {
      method: request.method,
      headers: request.headers,
      redirect: "manual",
    });
  },
};

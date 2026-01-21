export default {
  async fetch(request) {
    const url = new URL(request.url);
    const password = "caramelzhenkeai";
    const upstream = "https://smartelectricity.pages.dev/";

    const authHeader = request.headers.get("Authorization") || "";
    const expected = "Basic " + btoa(`user:${password}`);

    if (authHeader !== expected) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Restricted"' },
      });
    }

    const targetUrl = upstream + url.pathname.replace(/^\//, "");
    return fetch(targetUrl, {
      method: request.method,
      headers: request.headers,
      redirect: "manual",
    });
  },
};

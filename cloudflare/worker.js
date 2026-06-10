export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const upstream = "https://smartelectricity.pages.dev/";

    const targetUrl = upstream + url.pathname.replace(/^\//, "");
    return fetch(targetUrl, {
      method: request.method,
      headers: request.headers,
      redirect: "manual",
    });
  },
};

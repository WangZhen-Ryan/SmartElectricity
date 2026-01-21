const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-amber-token, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split("/").pop() || "";

  const token = Deno.env.get("AMBER_TOKEN") || req.headers.get("x-amber-token") || "";
  const siteId = url.searchParams.get("siteId") || Deno.env.get("AMBER_SITE_ID") || "";

  if (!token) {
    return json({ error: "Missing AMBER_TOKEN." }, 400);
  }

  if (path === "sites") {
    const resp = await fetch("https://api.amber.com.au/v1/sites", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return proxy(resp);
  }

  if (!siteId) {
    return json({ error: "Missing siteId." }, 400);
  }

  if (path === "current") {
    const previous = url.searchParams.get("previous") || "0";
    const next = url.searchParams.get("next") || "4";
    const resolution = url.searchParams.get("resolution") || "30";
    const params = new URLSearchParams({ previous, next, resolution }).toString();
    const resp = await fetch(
      `https://api.amber.com.au/v1/sites/${siteId}/prices/current?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return proxy(resp);
  }

  if (path === "prices") {
    const startDate = url.searchParams.get("startDate") || "";
    const endDate = url.searchParams.get("endDate") || "";
    const resolution = url.searchParams.get("resolution") || "30";
    if (!startDate || !endDate) {
      return json({ error: "Missing startDate/endDate." }, 400);
    }
    const params = new URLSearchParams({ startDate, endDate, resolution }).toString();
    const resp = await fetch(
      `https://api.amber.com.au/v1/sites/${siteId}/prices?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return proxy(resp);
  }

  if (path === "config") {
    return json({ siteId, hasToken: Boolean(token) }, 200);
  }

  return json({ error: "Unknown endpoint." }, 404);
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function proxy(resp: Response) {
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

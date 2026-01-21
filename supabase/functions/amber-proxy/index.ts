const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-amber-token, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const trimmed = url.pathname.replace(/\/+$/, "");
    const path = trimmed.split("/").pop() || "config";

    const token = Deno.env.get("AMBER_TOKEN") || req.headers.get("x-amber-token") || "";
    const siteId = url.searchParams.get("siteId") || Deno.env.get("AMBER_SITE_ID") || "";

    if (!token) {
      return json({ error: "Missing AMBER_TOKEN." }, 400);
    }

    if (path === "config") {
      return json({ siteId, hasToken: Boolean(token) }, 200);
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
      const start = parseDateParam(startDate);
      const end = parseDateParam(endDate);
      if (!start || !end) {
        return json({ error: "Invalid startDate/endDate." }, 400);
      }
      const days = dayDiff(start, end) + 1;
      if (days <= 7) {
        const params = new URLSearchParams({ startDate, endDate, resolution }).toString();
        const resp = await fetch(
          `https://api.amber.com.au/v1/sites/${siteId}/prices?${params}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        return proxy(resp);
      }
      const chunks: unknown[] = [];
      let cursor = start;
      let guard = 0;
      while (cursor.getTime() <= end.getTime()) {
        const chunkEnd = addDays(cursor, 6);
        const sliceEnd = chunkEnd.getTime() > end.getTime() ? end : chunkEnd;
        const params = new URLSearchParams({
          startDate: toDateOnly(cursor),
          endDate: toDateOnly(sliceEnd),
          resolution,
        }).toString();
        const resp = await fetch(
          `https://api.amber.com.au/v1/sites/${siteId}/prices?${params}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!resp.ok) {
          return proxy(resp);
        }
        const payload = await resp.json();
        if (Array.isArray(payload)) {
          chunks.push(...payload);
        }
        cursor = addDays(sliceEnd, 1);
        guard += 1;
        if (guard > 60) break;
      }
      return json(chunks, 200);
    }

    if (path === "usage") {
      const startDate = url.searchParams.get("startDate") || "";
      const endDate = url.searchParams.get("endDate") || "";
      const resolution = url.searchParams.get("resolution") || "30";
      if (!startDate || !endDate) {
        return json({ error: "Missing startDate/endDate." }, 400);
      }

      const start = parseDateParam(startDate);
      const end = parseDateParam(endDate);
      if (!start || !end) {
        return json({ error: "Invalid startDate/endDate." }, 400);
      }

      const days = dayDiff(start, end) + 1;
      if (days <= 7) {
        const params = new URLSearchParams({ startDate, endDate, resolution }).toString();
        const resp = await fetch(
          `https://api.amber.com.au/v1/sites/${siteId}/usage?${params}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        return proxy(resp);
      }

      const chunks: unknown[] = [];
      let cursor = start;
      let guard = 0;
      while (cursor.getTime() <= end.getTime()) {
        const chunkEnd = addDays(cursor, 6);
        const sliceEnd = chunkEnd.getTime() > end.getTime() ? end : chunkEnd;
        const params = new URLSearchParams({
          startDate: toDateOnly(cursor),
          endDate: toDateOnly(sliceEnd),
          resolution,
        }).toString();
        const resp = await fetch(
          `https://api.amber.com.au/v1/sites/${siteId}/usage?${params}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!resp.ok) {
          return proxy(resp);
        }
        const payload = await resp.json();
        if (Array.isArray(payload)) {
          chunks.push(...payload);
        }
        cursor = addDays(sliceEnd, 1);
        guard += 1;
        if (guard > 60) break;
      }
      return json(chunks, 200);
    }

    if (path === "llm") {
      if (req.method !== "POST") {
        return json({ error: "Use POST for LLM requests." }, 405);
      }
      const openRouterKey = Deno.env.get("OPENROUTER_API_KEY") || "";
      if (!openRouterKey) {
        return json({ error: "Missing OPENROUTER_API_KEY." }, 400);
      }
      const body = await req.json().catch(() => null);
      if (!body || !body.messages || !body.model) {
        return json({ error: "Missing model/messages." }, 400);
      }
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: body.model,
          messages: body.messages,
          temperature: body.temperature ?? 0.2,
          max_tokens: body.max_tokens ?? 300,
        }),
      });
      return proxy(resp);
    }

    return json({ error: "Unknown endpoint." }, 404);
  } catch (err) {
    return json({ error: "Internal server error", detail: String(err) }, 500);
  }
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

function parseDateParam(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dayDiff(start: Date, end: Date) {
  const startStamp = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endStamp = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.floor((endStamp - startStamp) / (24 * 60 * 60 * 1000));
}

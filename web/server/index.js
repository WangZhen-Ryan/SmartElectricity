import express from "express";
import fs from "fs";
import path from "path";

const app = express();
const PORT = Number(process.env.PORT || 5174);
const ROOT_DIR = process.env.AMBER_DATA_DIR || path.resolve(process.cwd(), "..");
const AMBER_SITE_ID = process.env.AMBER_SITE_ID || "";
const AMBER_TOKEN = process.env.AMBER_TOKEN || "";

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/config", (_req, res) => {
  res.json({
    siteId: AMBER_SITE_ID,
    hasToken: Boolean(AMBER_TOKEN),
  });
});

app.get("/api/caches", (_req, res) => {
  const entries = [];
  for (const name of fs.readdirSync(ROOT_DIR)) {
    if (!name.endsWith(".json")) continue;
    if (!name.startsWith("amber_") && name !== "amber_cache.json") continue;
    const full = path.join(ROOT_DIR, name);
    const stats = fs.statSync(full);
    entries.push({
      name,
      modified: stats.mtimeMs,
      size: stats.size,
    });
  }
  entries.sort((a, b) => b.modified - a.modified);
  res.json(entries);
});

app.get("/api/cache", (req, res) => {
  const name = String(req.query.name || "");
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    res.status(400).json({ error: "Invalid cache name." });
    return;
  }
  const full = path.join(ROOT_DIR, name);
  if (!fs.existsSync(full)) {
    res.status(404).json({ error: "Cache not found." });
    return;
  }
  const text = fs.readFileSync(full, "utf-8");
  res.type("application/json").send(text);
});

app.get("/api/prices", async (req, res) => {
  const siteId = String(req.query.siteId || AMBER_SITE_ID);
  const startDate = String(req.query.startDate || "");
  const endDate = String(req.query.endDate || "");
  const resolution = String(req.query.resolution || "30");
  const token = String(req.headers["x-amber-token"] || AMBER_TOKEN);

  if (!siteId || !token) {
    res.status(400).json({ error: "Missing siteId or token." });
    return;
  }
  if (!startDate || !endDate) {
    res.status(400).json({ error: "Missing startDate or endDate." });
    return;
  }

  const params = new URLSearchParams({
    startDate,
    endDate,
    resolution,
  }).toString();
  const url = `https://api.amber.com.au/v1/sites/${siteId}/prices?${params}`;

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await resp.text();
    res.status(resp.status).type("application/json").send(text);
  } catch (err) {
    res.status(502).json({ error: "Upstream request failed." });
  }
});

app.get("/api/current", async (req, res) => {
  const siteId = String(req.query.siteId || AMBER_SITE_ID);
  const previous = String(req.query.previous || "0");
  const next = String(req.query.next || "4");
  const resolution = String(req.query.resolution || "30");
  const token = String(req.headers["x-amber-token"] || AMBER_TOKEN);

  if (!siteId || !token) {
    res.status(400).json({ error: "Missing siteId or token." });
    return;
  }

  const params = new URLSearchParams({
    previous,
    next,
    resolution,
  }).toString();
  const url = `https://api.amber.com.au/v1/sites/${siteId}/prices/current?${params}`;

  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await resp.text();
    res.status(resp.status).type("application/json").send(text);
  } catch (_err) {
    res.status(502).json({ error: "Upstream request failed." });
  }
});

app.listen(PORT, () => {
  console.log(`Amber proxy running on http://localhost:${PORT}`);
});

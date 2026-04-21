const express = require("express");
const fetch = require("node-fetch");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static("public"));

// ─── YOUR AIRTABLE SETTINGS ──────────────────────────────────────────
// Paste your values here after setting up Airtable (Step 1 in the guide)
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE   = "Codes";
// ─────────────────────────────────────────────────────────────────────

const AIRTABLE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE}`;
const HEADERS = {
  "Authorization": `Bearer ${AIRTABLE_API_KEY}`,
  "Content-Type": "application/json"
};

// Helper: fetch all records from Airtable
async function getAllCodes() {
  const res = await fetch(AIRTABLE_URL, { headers: HEADERS });
  const data = await res.json();
  if (!data.records) return [];
  return data.records.map(r => ({
    id: r.id,
    name: r.fields.name || "",
    slug: r.fields.slug || "",
    destination: r.fields.destination || "",
    active: r.fields.active || false,
    scans: r.fields.scans || 0,
  }));
}

// Helper: find one record by slug
async function getCodeBySlug(slug) {
  const url = `${AIRTABLE_URL}?filterByFormula={slug}="${slug}"`;
  const res = await fetch(url, { headers: HEADERS });
  const data = await res.json();
  if (!data.records || data.records.length === 0) return null;
  const r = data.records[0];
  return {
    id: r.id,
    name: r.fields.name || "",
    slug: r.fields.slug || "",
    destination: r.fields.destination || "",
    active: r.fields.active !== false,
    scans: r.fields.scans || 0,
  };
}

// ── REDIRECT ROUTE ── The URL printed on QR codes
// When someone scans a QR code, they hit this route
app.get("/r/:slug", async (req, res) => {
  try {
    const code = await getCodeBySlug(req.params.slug);
    if (!code || !code.active) {
      return res.status(404).send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:3rem">
          <h2>QR code not found or inactive</h2>
          <p>This link may have been paused or removed.</p>
        </body></html>
      `);
    }
    // Increment scan count
    await fetch(`${AIRTABLE_URL}/${code.id}`, {
      method: "PATCH",
      headers: HEADERS,
      body: JSON.stringify({ fields: { scans: code.scans + 1 } })
    });
    // Redirect to destination
    res.redirect(302, code.destination);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// ── API: Get all codes (for dashboard)
app.get("/api/codes", async (req, res) => {
  try {
    const codes = await getAllCodes();
    res.json(codes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Create a new QR code
app.post("/api/codes", async (req, res) => {
  const { name, slug, destination } = req.body;
  if (!name || !slug || !destination) {
    return res.status(400).json({ error: "name, slug, and destination are required" });
  }
  try {
    const existing = await getCodeBySlug(slug);
    if (existing) return res.status(409).json({ error: "Slug already in use" });
    const r = await fetch(AIRTABLE_URL, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ fields: { name, slug, destination, active: true, scans: 0 } })
    });
    const data = await r.json();
    res.json({ id: data.id, name, slug, destination, active: true, scans: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Update destination URL
app.patch("/api/codes/:id", async (req, res) => {
  const { destination, active, name } = req.body;
  const fields = {};
  if (destination !== undefined) fields.destination = destination;
  if (active !== undefined) fields.active = active;
  if (name !== undefined) fields.name = name;
  try {
    const r = await fetch(`${AIRTABLE_URL}/${req.params.id}`, {
      method: "PATCH",
      headers: HEADERS,
      body: JSON.stringify({ fields })
    });
    const data = await r.json();
    res.json({ id: data.id, ...data.fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Delete a QR code
app.delete("/api/codes/:id", async (req, res) => {
  try {
    await fetch(`${AIRTABLE_URL}/${req.params.id}`, {
      method: "DELETE",
      headers: HEADERS
    });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve dashboard for any other route
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`QR Bridge running on port ${PORT}`));

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// products.json ships with the code, so it always reads from the repo.
// orders.json / config.json are WRITABLE data — on Railway's default
// filesystem they get wiped on every redeploy, so if you attach a volume,
// set DATA_DIR to its mount path (e.g. DATA_DIR=/data) and they'll persist.
const DATA_DIR = process.env.DATA_DIR || __dirname;

const PRODUCTS_PATH = path.join(__dirname, "products.json");
const ORDERS_PATH = path.join(DATA_DIR, "orders.json");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// ---------- helpers ----------
function readJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (e) {
    console.error("Failed reading", filePath, e);
    return fallback;
  }
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getProducts() {
  return readJSON(PRODUCTS_PATH, []);
}

// ADMIN_WHATSAPP_NUMBER env var (Railway → Variables) always wins if set,
// so the real number never has to be committed to config.json / your repo.
function getConfig() {
  const fileConfig = readJSON(CONFIG_PATH, { adminWhatsappNumber: "22900000000", siteName: "NexSub" });
  return {
    ...fileConfig,
    adminWhatsappNumber: process.env.ADMIN_WHATSAPP_NUMBER || fileConfig.adminWhatsappNumber,
    siteName: process.env.SITE_NAME || fileConfig.siteName
  };
}

// ---------- routes ----------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, dataDir: DATA_DIR });
});

// Computes one cart line's price server-side. Never trusts a price sent from
// the browser — only qty/amount/tierId/itemCost selections are taken from
// the client, and every price is recomputed here from products.json.
function priceLine(product, item) {
  const qty = Math.max(1, parseInt(item.qty, 10) || 1);
  const type = product.type || "fixed";

  if (type === "tiered") {
    const tier = (product.tiers || []).find((t) => t.id === item.tierId);
    if (!tier) {
      return { error: `Missing or invalid tierId for ${product.id}` };
    }
    return {
      id: product.id,
      name: `${product.name} — ${tier.label}`,
      qty,
      unitPrice: tier.price,
      lineTotal: tier.price * qty
    };
  }

  if (type === "amount_calc") {
    const amount = Math.max(
      product.minAmount || 1,
      parseInt(item.amount, 10) || 0
    );
    const unitPrice = product.baseCostPerUnit * (1 + (product.marginPercent || 0) / 100);
    const lineTotal = Math.round(unitPrice * amount);
    return {
      id: product.id,
      name: `${product.name} (${amount} ${product.unitLabel || "units"})`,
      qty: 1,
      unitPrice: Math.round(unitPrice * 100) / 100,
      lineTotal
    };
  }

  if (type === "percent_fee") {
    const itemCost = Math.max(0, parseFloat(item.itemCost) || 0);
    if (itemCost <= 0) {
      return { error: `Missing item cost for ${product.id}` };
    }
    // Transport fee varies by carrier/weight, so the client enters it manually
    // per order rather than it being computed — but it's still validated
    // and totalled server-side, never trusted as a final price from the client.
    const transportFee = Math.max(0, parseFloat(item.transportFee) || 0);
    const handlingFee = Math.round(itemCost * ((product.feePercent || 0) / 100));
    const lineTotal = (itemCost + handlingFee + transportFee) * qty;
    return {
      id: product.id,
      name: `${product.name} (cost ${itemCost} + ${product.feePercent}% handling + ${transportFee} transport)`,
      qty,
      unitPrice: itemCost + handlingFee + transportFee,
      lineTotal
    };
  }

  // fixed (default)
  if (!product.price || product.price === 0) {
    return {
      id: product.id,
      name: product.name,
      qty,
      unitPrice: null,
      lineTotal: null,
      note: product.priceNote || "Custom quote"
    };
  }
  return {
    id: product.id,
    name: product.name,
    qty,
    unitPrice: product.price,
    lineTotal: product.price * qty
  };
}

function computeCart(items) {
  const products = getProducts();
  let total = 0;
  const lines = [];
  let hasCustomQuoteItem = false;
  const errors = [];

  for (const item of items) {
    const product = products.find((p) => p.id === item.id);
    if (!product) continue;

    const line = priceLine(product, item);
    if (line.error) {
      errors.push(line.error);
      continue;
    }
    if (line.lineTotal === null) hasCustomQuoteItem = true;
    else total += line.lineTotal;
    lines.push(line);
  }

  return { lines, total, currency: "XAF", hasCustomQuoteItem, errors };
}

// ---------- routes ----------

// List all products
app.get("/api/products", (req, res) => {
  res.json(getProducts());
});

// Compute a cart total server-side (never trust client-sent totals)
// items: [{ id, qty, tierId?, amount?, itemCost? }]
app.post("/api/cart/total", (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: "items must be an array" });
  }
  const result = computeCart(items);
  res.json(result);
});

// Create an order, store it, and return a pre-filled WhatsApp link for the admin
app.post("/api/orders", (req, res) => {
  const { items, customerName, customerContact, notes } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Cart is empty" });
  }
  if (!customerName || !customerContact) {
    return res.status(400).json({ error: "customerName and customerContact are required" });
  }

  const { lines, total, hasCustomQuoteItem, errors } = computeCart(items);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join("; ") });
  }
  if (lines.length === 0) {
    return res.status(400).json({ error: "No valid items in cart" });
  }

  const orders = readJSON(ORDERS_PATH, []);
  const order = {
    id: "ORD-" + Date.now(),
    createdAt: new Date().toISOString(),
    customerName,
    customerContact,
    notes: notes || "",
    lines,
    total,
    currency: "XAF",
    status: "pending"
  };
  orders.push(order);
  writeJSON(ORDERS_PATH, orders);

  // Build the pre-formatted order message for WhatsApp
  const config = getConfig();
  const itemsText = lines
    .map((l) => {
      const priceText = l.lineTotal === null ? "quote on request" : `${l.lineTotal} ${order.currency}`;
      return `- ${l.name} x${l.qty} → ${priceText}`;
    })
    .join("\n");

  const messageBody =
    `New order ${order.id}\n` +
    `Customer: ${customerName} (${customerContact})\n\n` +
    `${itemsText}\n\n` +
    `Total: ${total} ${order.currency}${hasCustomQuoteItem ? " + items needing a custom quote" : ""}\n` +
    (notes ? `Notes: ${notes}\n` : "");

  const whatsappUrl = `https://wa.me/${config.adminWhatsappNumber}?text=${encodeURIComponent(messageBody)}`;

  res.json({ order, whatsappUrl });
});

// List orders (simple admin view — add real auth before going to production)
app.get("/api/orders", (req, res) => {
  res.json(readJSON(ORDERS_PATH, []));
});

// Get / update site config (admin WhatsApp number, site name)
app.get("/api/config", (req, res) => {
  res.json(getConfig());
});

app.post("/api/config", (req, res) => {
  const current = getConfig();
  const updated = { ...current, ...req.body };
  writeJSON(CONFIG_PATH, updated);
  res.json(updated);
});

app.listen(PORT, () => {
  console.log(`NexSub server running on http://localhost:${PORT}`);
});

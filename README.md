# NexSub — storefront scaffold

Cart with +/- quantity, server-calculated totals, and one-click checkout
that opens WhatsApp with a pre-filled order summary sent to your admin number.

Product names are placeholders — swap in your own legitimate catalog. Logo
slots are empty (dashed boxes labeled "Logo ici") — drop your own image
files in `public/img/` and reference them in `server/products.json`.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000

## Project layout

```
nexsub/
├── server/
│   ├── index.js       # Express API (products, cart total, orders)
│   ├── products.json  # Your product catalog — edit this
│   ├── config.json    # Admin WhatsApp number + site name
│   └── orders.json    # Created automatically once orders come in
└── public/
    ├── index.html
    ├── style.css       # neon / particle theme
    ├── particles.js    # background particle animation
    └── script.js       # cart logic, calls the backend API
```

## Customize the catalog

Edit `server/products.json`. Each product:

```json
{
  "id": "unique-id",
  "name": "Your Product Name",
  "category": "Category",
  "price": 2000,
  "currency": "XOF",
  "logo": "/img/your-logo.png",
  "description": "Short description shown on the card"
}
```

Set `"price": 0` and add a `"priceNote"` string for anything you want to
quote per-client instead of a fixed price (the cart will show "custom quote"
and the admin fills in the real number on WhatsApp).

### Product types

Every product has a `"type"` field (defaults to `"fixed"` if omitted):

- **`"fixed"`** — a flat price, `qty` +/- stepper. Most products.
- **`"tiered"`** — client picks one of several plan lengths, each with its
  own price:
  ```json
  {
    "type": "tiered",
    "tiers": [
      { "id": "1m", "label": "1 month", "price": 2500 },
      { "id": "3m", "label": "3 months", "price": 6500 }
    ]
  }
  ```
- **`"amount_calc"`** — client enters a quantity/amount, price is computed
  from your cost + margin:
  ```json
  {
    "type": "amount_calc",
    "baseCostPerUnit": 8,
    "marginPercent": 30,
    "minAmount": 100,
    "step": 50,
    "unitLabel": "units"
  }
  ```
  Price = `amount × baseCostPerUnit × (1 + marginPercent/100)`, rounded.
  Update `baseCostPerUnit` and `marginPercent` to match your real supplier
  cost and desired margin.
- **`"percent_fee"`** — client enters an item cost, a percentage fee is
  added automatically (e.g. shipping/handling):
  ```json
  { "type": "percent_fee", "feePercent": 20 }
  ```
  Price = `itemCost × (1 + feePercent/100)`.

All of these are recalculated server-side in `server/index.js` — the
browser never gets to dictate the final price, only the qty/tier/amount/cost
selection.

## Set your WhatsApp admin number

Edit `server/config.json`:

```json
{
  "adminWhatsappNumber": "22900000000",
  "siteName": "NexSub"
}
```

Use the full international number, no `+` or spaces (e.g. `22990112233`).

## Notes on going to production

- `orders.json` and `config.json` are flat JSON files — fine for getting
  started, but swap in a real database (Postgres/SQLite) before you have
  real order volume or multiple people editing at once.
- The `/api/orders` GET endpoint has no auth — add a login/admin token
  before exposing this publicly.
- Prices are always recalculated server-side from `products.json`, never
  trusted from the browser, so someone can't tamper with totals in devtools.

## Deploying to Railway

1. **Push this project to a GitHub repo** (or use Railway's CLI to deploy
   directly). `node_modules` is excluded via `.gitignore` — Railway installs
   dependencies itself from `package.json`.

2. **Create a new Railway project** → "Deploy from GitHub repo" → pick this
   repo. Railway auto-detects Node.js and runs `npm install` then
   `npm start`.

3. **Set environment variables** (Railway dashboard → your service →
   Variables):
   - `ADMIN_WHATSAPP_NUMBER` — your real number, full international format,
     no `+` (e.g. `237600000000`). This overrides whatever is in
     `server/config.json`, so your real number never has to be committed
     to the repo.
   - `SITE_NAME` — optional, overrides the site name.
   - `DATA_DIR` — only needed if you attach a persistent volume (see next
     step). Otherwise leave unset.
   - You do **not** need to set `PORT` — Railway sets it automatically and
     the app already reads `process.env.PORT`.

4. **Add a persistent volume** (Railway dashboard → your service →
   Volumes → "New Volume", mount path e.g. `/data`). Without this,
   `orders.json` and any config changes get wiped every time you redeploy,
   because Railway's default filesystem is ephemeral. With the volume
   attached, set:
   - `DATA_DIR=/data`
   
   and orders/config will persist across deploys.

5. **Deploy.** Railway gives you a public URL
   (`https://your-app.up.railway.app`) — the frontend calls the API on the
   same origin (`API = ""` in `public/script.js`), so no extra config is
   needed there.

6. **Paste in your real product catalog** by editing `server/products.json`
   in your repo and pushing — Railway redeploys automatically on push.
   (`server/products.json` ships with the code and is *not* affected by
   the volume/`DATA_DIR` setting — only `orders.json`/`config.json` are.)

Quick check after deploying: visit `https://your-app.up.railway.app/api/health`
— it should return `{"ok":true,"dataDir":"..."}`.

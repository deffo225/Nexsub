const API = ""; // same-origin; change if backend is hosted elsewhere, e.g. "https://api.yoursite.com"

let products = [];
// cart is an array of line entries, since some products need extra data
// (tierId / amount / itemCost) alongside qty, not just a simple id->qty map.
// entry shape: { key, id, qty, tierId?, amount?, itemCost? }
let cart = [];

const productGrid = document.getElementById("product-grid");
const cartItemsEl = document.getElementById("cart-items");
const cartTotalEl = document.getElementById("cart-total");
const cartCountEl = document.getElementById("cart-count");
const quoteNoteEl = document.getElementById("quote-note");
const checkoutForm = document.getElementById("checkout-form");
const checkoutBtn = document.getElementById("checkout-btn");

async function loadProducts() {
  const res = await fetch(`${API}/api/products`);
  products = await res.json();
  renderProducts();
}

function findCartEntry(id) {
  return cart.find((e) => e.id === id);
}

function removeCartEntry(id) {
  cart = cart.filter((e) => e.id !== id);
}

function renderProducts() {
  productGrid.innerHTML = "";
  for (const p of products) {
    const type = p.type || "fixed";
    const card = document.createElement("div");
    card.className = "product-card";

    const logoHtml = p.logo ? `<img src="${p.logo}" alt="${p.name} logo">` : `Logo ici`;

    let bodyHtml = "";

    if (type === "tiered") {
      const entry = findCartEntry(p.id);
      const selectedTier = entry?.tierId || "";
      const qty = entry?.qty || 0;
      bodyHtml = `
        <div class="tier-select">
          ${p.tiers
            .map(
              (t) => `
            <button class="tier-btn ${selectedTier === t.id ? "active" : ""}" data-id="${p.id}" data-tier="${t.id}">
              ${t.label}<br><small>${t.price} ${p.currency}</small>
            </button>`
            )
            .join("")}
        </div>
        <div class="qty-control">
          <button data-action="dec" data-id="${p.id}" data-type="tiered">−</button>
          <span id="qty-${p.id}">${qty}</span>
          <button data-action="inc" data-id="${p.id}" data-type="tiered">+</button>
        </div>
      `;
    } else if (type === "amount_calc") {
      const entry = findCartEntry(p.id);
      const amount = entry?.amount || p.minAmount || 0;
      const unitPrice = p.baseCostPerUnit * (1 + (p.marginPercent || 0) / 100);
      bodyHtml = `
        <label class="amount-label">
          Amount (${p.unitLabel || "units"})
          <input type="number" class="amount-input" data-id="${p.id}" min="${p.minAmount || 1}" step="${p.step || 1}" value="${amount}">
        </label>
        <div class="price" id="calc-price-${p.id}">${Math.round(unitPrice * amount)} ${p.currency}</div>
        <button class="add-btn" data-action="add-amount" data-id="${p.id}">${entry ? "Update" : "Add to cart"}</button>
      `;
    } else if (type === "percent_fee") {
      const entry = findCartEntry(p.id);
      const itemCost = entry?.itemCost || "";
      const transportFee = entry?.transportFee || "";
      bodyHtml = `
        <label class="amount-label">
          Item cost (${p.currency})
          <input type="number" class="cost-input" data-id="${p.id}" min="0" step="1" value="${itemCost}" placeholder="e.g. 15000">
        </label>
        <label class="amount-label">
          Transport fee (${p.currency}) — varies by carrier/weight
          <input type="number" class="transport-input" data-id="${p.id}" min="0" step="1" value="${transportFee}" placeholder="e.g. 3000">
        </label>
        <p style="color:var(--text-dim); font-size:0.78rem; margin:4px 0 10px;">+ ${p.feePercent}% handling fee, added automatically on top of item cost + transport</p>
        <button class="add-btn" data-action="add-cost" data-id="${p.id}">${entry ? "Update" : "Add to cart"}</button>
      `;
    } else {
      // fixed
      const entry = findCartEntry(p.id);
      const qty = entry?.qty || 0;
      bodyHtml = `
        <div class="price">${p.price} ${p.currency}</div>
        <div class="qty-control">
          <button data-action="dec" data-id="${p.id}" data-type="fixed">−</button>
          <span id="qty-${p.id}">${qty}</span>
          <button data-action="inc" data-id="${p.id}" data-type="fixed">+</button>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="product-logo">${logoHtml}</div>
      <div class="category">${p.category}</div>
      <h3>${p.name}</h3>
      <p style="color:var(--text-dim); font-size:0.85rem; margin-bottom:10px;">${p.description || ""}</p>
      ${bodyHtml}
    `;
    productGrid.appendChild(card);
  }

  attachProductListeners();
}

function attachProductListeners() {
  // fixed / tiered qty steppers
  productGrid.querySelectorAll("button[data-action='inc'], button[data-action='dec']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const type = btn.dataset.type;
      const action = btn.dataset.action;
      let entry = findCartEntry(id);

      if (type === "tiered" && !entry) {
        // need a tier selected before qty can increase
        const product = products.find((p) => p.id === id);
        alert(`Choose a plan for "${product.name}" first.`);
        return;
      }

      if (!entry) {
        entry = { key: id, id, qty: 0 };
        cart.push(entry);
      }
      entry.qty = action === "inc" ? entry.qty + 1 : Math.max(0, entry.qty - 1);
      if (entry.qty === 0) removeCartEntry(id);

      renderProducts();
      syncCart();
    });
  });

  // tier selection buttons
  productGrid.querySelectorAll(".tier-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const tierId = btn.dataset.tier;
      let entry = findCartEntry(id);
      if (!entry) {
        entry = { key: id, id, qty: 1, tierId };
        cart.push(entry);
      } else {
        entry.tierId = tierId;
        if (entry.qty === 0) entry.qty = 1;
      }
      renderProducts();
      syncCart();
    });
  });

  // amount_calc live price preview
  productGrid.querySelectorAll(".amount-input").forEach((input) => {
    input.addEventListener("input", () => {
      const id = input.dataset.id;
      const product = products.find((p) => p.id === id);
      const amount = Math.max(product.minAmount || 1, parseInt(input.value, 10) || 0);
      const unitPrice = product.baseCostPerUnit * (1 + (product.marginPercent || 0) / 100);
      const priceEl = document.getElementById(`calc-price-${id}`);
      if (priceEl) priceEl.textContent = `${Math.round(unitPrice * amount)} ${product.currency}`;
    });
  });

  productGrid.querySelectorAll("button[data-action='add-amount']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const product = products.find((p) => p.id === id);
      const input = productGrid.querySelector(`.amount-input[data-id="${id}"]`);
      const amount = Math.max(product.minAmount || 1, parseInt(input.value, 10) || 0);
      let entry = findCartEntry(id);
      if (!entry) {
        entry = { key: id, id, qty: 1, amount };
        cart.push(entry);
      } else {
        entry.amount = amount;
      }
      renderProducts();
      syncCart();
    });
  });

  // percent_fee add/update
  productGrid.querySelectorAll("button[data-action='add-cost']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const costInput = productGrid.querySelector(`.cost-input[data-id="${id}"]`);
      const transportInput = productGrid.querySelector(`.transport-input[data-id="${id}"]`);
      const itemCost = Math.max(0, parseFloat(costInput.value) || 0);
      const transportFee = Math.max(0, parseFloat(transportInput.value) || 0);
      if (itemCost <= 0) {
        alert("Enter the item cost first.");
        return;
      }
      let entry = findCartEntry(id);
      if (!entry) {
        entry = { key: id, id, qty: 1, itemCost, transportFee };
        cart.push(entry);
      } else {
        entry.itemCost = itemCost;
        entry.transportFee = transportFee;
      }
      renderProducts();
      syncCart();
    });
  });
}

function cartItemsPayload() {
  return cart.map((e) => ({
    id: e.id,
    qty: e.qty,
    tierId: e.tierId,
    amount: e.amount,
    itemCost: e.itemCost,
    transportFee: e.transportFee
  }));
}

async function syncCart() {
  const items = cartItemsPayload().filter((i) => i.qty > 0 || i.amount || i.itemCost);
  cartCountEl.textContent = items.reduce((sum, i) => sum + (i.qty || 1), 0);

  if (items.length === 0) {
    cartItemsEl.innerHTML = `<p class="empty-cart">Ton panier est vide.</p>`;
    cartTotalEl.textContent = "0 XAF";
    quoteNoteEl.classList.add("hidden");
    checkoutBtn.disabled = true;
    return;
  }

  const res = await fetch(`${API}/api/cart/total`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items })
  });
  const data = await res.json();

  cartItemsEl.innerHTML = "";
  for (const line of data.lines) {
    const div = document.createElement("div");
    div.className = "cart-line";
    const priceText = line.lineTotal === null ? (line.note || "Devis sur demande") : `${line.lineTotal} ${data.currency}`;
    div.innerHTML = `
      <div>
        <div class="name">${line.name}</div>
        <div class="meta">x${line.qty}</div>
      </div>
      <div>${priceText}</div>
    `;
    cartItemsEl.appendChild(div);
  }

  cartTotalEl.textContent = `${data.total} ${data.currency}`;
  quoteNoteEl.classList.toggle("hidden", !data.hasCustomQuoteItem);
  checkoutBtn.disabled = false;
}

checkoutForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const items = cartItemsPayload().filter((i) => i.qty > 0 || i.amount || i.itemCost);
  if (items.length === 0) return;

  const customerName = document.getElementById("customerName").value.trim();
  const customerContact = document.getElementById("customerContact").value.trim();
  const notes = document.getElementById("notes").value.trim();

  // Open the tab synchronously, inside the click handler, BEFORE any await.
  // Browsers only allow window.open() without being blocked as a popup when
  // it happens directly in response to a user gesture — calling it after an
  // awaited fetch() loses that gesture context and gets silently blocked
  // (the order still succeeds server-side, which is why the cart clears,
  // but no WhatsApp tab appears). We open a blank tab now and redirect it
  // once we have the real WhatsApp URL.
  const whatsappTab = window.open("", "_blank");

  checkoutBtn.disabled = true;
  checkoutBtn.textContent = "Envoi en cours...";

  try {
    const res = await fetch(`${API}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, customerName, customerContact, notes })
    });
    const data = await res.json();

    if (!res.ok) {
      if (whatsappTab) whatsappTab.close();
      alert(data.error || "Une erreur est survenue.");
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = "Envoyer la commande sur WhatsApp";
      return;
    }

    if (whatsappTab) {
      whatsappTab.location.href = data.whatsappUrl;
    } else {
      // Popup was blocked even for the synchronous open (e.g. very strict
      // browser settings) — fall back to a same-tab redirect so the order
      // still reaches WhatsApp instead of silently failing.
      window.location.href = data.whatsappUrl;
    }

    cart = [];
    renderProducts();
    syncCart();
    checkoutForm.reset();
  } catch (err) {
    console.error(err);
    if (whatsappTab) whatsappTab.close();
    alert("Impossible de contacter le serveur.");
  } finally {
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = "Envoyer la commande sur WhatsApp";
  }
});

loadProducts().then(syncCart);

const STORAGE_KEY = "stockroom.inventory.v1";
const SALES_KEY = "stockroom.sales.v1";

// ==================== FIREBASE SETUP ====================
const firebaseConfig = {
  apiKey: "AIzaSyDdoRoZfBWZWb8G0MExsbD4KarmB8qZG6c",
  authDomain: "stockroom-a48c3.firebaseapp.com",
  projectId: "stockroom-a48c3",
  storageBucket: "stockroom-a48c3.firebasestorage.app",
  messagingSenderId: "629513576568",
  appId: "1:629513576568:web:ca15a5bed03c4877e34d8d"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
// =======================================================

let filterTimer;

const state = {
  tab: "inventory",
  query: "",
  category: "All",
  status: "All",
  products: [],
  sales: [],
  cart: {},
  editingId: null,
  labelIds: new Set(),
};

function uid() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}



async function load() {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  const sales = JSON.parse(localStorage.getItem(SALES_KEY) || "[]");
  
  state.products = Array.isArray(stored) && stored.length ? stored : [];
  state.sales = sales;

  // Load from Firebase
  try {
    const prodSnap = await db.collection("products").get();
    if (!prodSnap.empty) {
      state.products = prodSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    const salesSnap = await db.collection("sales").get();
    if (!salesSnap.empty) {
      state.sales = salesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }
  } catch (e) {
    console.log("Firebase load failed, using local data");
  }
}

async function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.products));
  localStorage.setItem(SALES_KEY, JSON.stringify(state.sales));

  // Save to Firebase
  try {
    for (const p of state.products) {
      await db.collection("products").doc(p.id).set(p);
    }
    for (const s of state.sales) {
      await db.collection("sales").doc(s.id).set(s);
    }
  } catch (e) {
    console.log("Firebase save failed");
  }
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

function number(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function totals() {
  const retail = state.products.reduce((sum, p) => sum + p.price * p.stock, 0);
  const cost = state.products.reduce((sum, p) => sum + p.cost * p.stock, 0);
  const units = state.products.reduce((sum, p) => sum + p.stock, 0);
  const low = state.products.filter((p) => p.stock <= p.reorder).length;
  const revenue = state.sales.reduce((sum, s) => sum + s.total, 0);
  return { retail, cost, units, low, revenue, margin: retail - cost };
}

function categories() {
  return ["All", ...Array.from(new Set(state.products.map((p) => p.category).filter(Boolean))).sort()];
}

function filteredProducts() {
  const q = state.query.trim().toLowerCase();
  return state.products.filter((p) => {
    const matchQuery = !q || [p.name, p.sku, p.category, p.barcode].some((x) => String(x).toLowerCase().includes(q));
    const matchCategory = state.category === "All" || p.category === state.category;
    const matchStatus =
      state.status === "All" ||
      (state.status === "In stock" && p.stock > p.reorder) ||
      (state.status === "Low" && p.stock > 0 && p.stock <= p.reorder) ||
      (state.status === "Out" && p.stock === 0);
    return matchQuery && matchCategory && matchStatus;
  });
}

function barcodeSvg(value, options = {}) {
  const text = String(value || "").slice(0, 32);
  const height = options.height || 72;
  const module = options.module || 1.35;
  const quiet = 10;
  const patterns = [
    "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
    "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
    "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
    "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
    "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
    "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
    "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
    "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
    "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
    "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
    "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
  ];

  const codes = [104];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    codes.push(code >= 32 && code <= 126 ? code - 32 : 0);
  }
  let checksum = codes[0];
  for (let i = 1; i < codes.length; i += 1) checksum += codes[i] * i;
  codes.push(checksum % 103, 106);

  let x = quiet;
  const bars = [];
  for (const code of codes) {
    const pattern = patterns[code];
    for (let i = 0; i < pattern.length; i += 1) {
      const width = Number(pattern[i]) * module;
      if (i % 2 === 0) bars.push(`<rect x="${x.toFixed(2)}" y="0" width="${width.toFixed(2)}" height="${height}" fill="#000"/>`);
      x += width;
    }
  }

  const width = x + quiet;
  return `<svg viewBox="0 0 ${width.toFixed(2)} ${height + 19}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Barcode ${escapeHtml(text)}"><rect width="100%" height="100%" fill="#fff"/>${bars.join("")}<text x="${width / 2}" y="${height + 14}" fill="#000" font-size="10" font-family="monospace" text-anchor="middle">${escapeHtml(text)}</text></svg>`;
}

function icon(name) {
  const icons = {
    box: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z M3.3 7 12 12l8.7-5 M12 22V12",
    plus: "M12 5v14 M5 12h14",
    cart: "M6 6h15l-1.5 8.5a2 2 0 0 1-2 1.5H9a2 2 0 0 1-2-1.6L5 3H2 M9 21h.01 M18 21h.01",
    barcode: "M3 5v14 M7 5v14 M10 5v14 M14 5v14 M17 5v14 M21 5v14",
    chart: "M3 3v18h18 M8 17V9 M13 17V5 M18 17v-7",
    tag: "M20.6 13.1 13 20.7a2 2 0 0 1-2.8 0L3.3 13.8a2 2 0 0 1-.6-1.4V5a2 2 0 0 1 2-2h7.4a2 2 0 0 1 1.4.6l7.1 7.1a2 2 0 0 1 0 2.8Z M7.5 7.5h.01",
    edit: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
    trash: "M3 6h18 M8 6V4h8v2 M6 6l1 15h10l1-15",
    print: "M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z",
    minus: "M5 12h14",
    search: "m21 21-4.3-4.3 M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z",
    download: "M12 3v12 M7 10l5 5 5-5 M5 21h14",
  };
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name]}"/></svg>`;
}

function productStatus(product) {
  if (product.stock === 0) return { label: "Out", className: "out" };
  if (product.stock <= product.reorder) return { label: "Low", className: "low" };
  return { label: "In stock", className: "" };
}

function render() {
  const app = document.querySelector("#app");
  const t = totals();
  const visible = filteredProducts();
  app.innerHTML = `
    <button class="hamburger" id="hamburger-btn" aria-label="Open menu">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
    </button>
    <div class="sidebar-overlay" id="sidebar-overlay"></div>
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <div class="mark">S</div>
          <div>
            <h1>Stockroom</h1>
            <p>Inventory, barcodes, sales</p>
          </div>
        </div>
        <nav class="nav">
          ${navButton("inventory", "box", "Inventory")}
          ${navButton("sell", "cart", "Sell")}
          ${navButton("labels", "barcode", "Labels")}
          ${navButton("reports", "chart", "Reports")}
        </nav>
        <div class="side-card">
          <p class="side-note">Local-first app. Your products and sales are stored on this computer in this browser.</p>
        </div>
      </aside>
      <main class="main">
        <div class="topbar">
          <div class="title-block">
            <h2>${pageTitle()}</h2>
            <p>${pageSubtitle()}</p>
          </div>
          <div class="actions">
            <button class="ghost-button" data-action="export">${icon("download")}Export JSON</button>
            <button class="primary-button" data-action="new-product">${icon("plus")}New product</button>
          </div>
        </div>
        ${renderStats(t)}
        ${state.tab === "inventory" ? renderInventory(visible) : ""}
        ${state.tab === "sell" ? renderSell(visible) : ""}
        ${state.tab === "labels" ? renderLabels(visible) : ""}
        ${state.tab === "reports" ? renderReports(t) : ""}
      </main>
    </div>
    <div id="print-area"></div>
  `;
  bindEvents();
}

function navButton(tab, iconName, label) {
  return `<button class="${state.tab === tab ? "active" : ""}" data-tab="${tab}"><span class="nav-icon">${icon(iconName)}</span>${label}</button>`;
}

function pageTitle() {
  return { inventory: "Inventory", sell: "Checkout", labels: "Barcode labels", reports: "Reports" }[state.tab];
}

function pageSubtitle() {
  return {
    inventory: "Add products, track stock, and watch value in real time.",
    sell: "Ring up sales and inventory updates instantly.",
    labels: "Generate scannable Code 128 labels for any product.",
    reports: "Simple sales and value snapshots for your stock.",
  }[state.tab];
}

function renderStats(t) {
  return `
    <section class="grid stats">
      <div class="stat"><small>Retail inventory value</small><strong>${money(t.retail)}</strong><span>${money(t.margin)} projected gross margin</span></div>
      <div class="stat"><small>Units in stock</small><strong>${number(t.units)}</strong><span>${state.products.length} products tracked</span></div>
      <div class="stat"><small>Low stock</small><strong>${number(t.low)}</strong><span>At or below reorder level</span></div>
      <div class="stat"><small>Total sales recorded</small><strong>${money(t.revenue)}</strong><span>${state.sales.length} completed checkouts</span></div>
    </section>
  `;
}

function renderFilters() {
  return `
    <div class="search-row">
      <input class="input" data-input="query" value="${escapeHtml(state.query)}" placeholder="Search products, SKU, barcode" />
      <select class="select" data-input="category">
        ${categories().map((c) => `<option ${state.category === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
      </select>
      <select class="select" data-input="status">
        ${["All", "In stock", "Low", "Out"].map((s) => `<option ${state.status === s ? "selected" : ""}>${s}</option>`).join("")}
      </select>
    </div>
  `;
}

function renderInventory(products) {
  return `
    <section class="panel">
      <div class="panel-head">
        <div><h3>Products</h3><p>${products.length} shown from ${state.products.length} total</p></div>
      </div>
      ${renderFilters()}
      ${renderProductTable(products)}
    </section>
  `;
}

function renderProductTable(products) {
  if (!products.length) return `<div class="empty">No matching products yet.</div>`;
  return `
    <table>
      <thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Price</th><th>Value</th><th>Barcode</th><th></th></tr></thead>
      <tbody>
        ${products.map((p) => {
          const status = productStatus(p);
          return `
            <tr>
              <td>
                <div class="product-cell">
                  <span class="swatch" style="${p.image ? "background:url('" + p.image + "') center/cover no-repeat" : "background:#333"}"></span>
                  <div><span class="product-name">${escapeHtml(p.name)}</span><span class="sku">${escapeHtml(p.sku)}</span></div>
                </div>
              </td>
              <td>${escapeHtml(p.category)}</td>
              <td><span class="pill ${status.className}">${number(p.stock)} · ${status.label}</span></td>
              <td>${money(p.price)}</td>
              <td>${money(p.price * p.stock)}</td>
              <td><span class="sku">${escapeHtml(p.barcode)}</span></td>
              <td>
                <div class="table-actions">
                  <button class="icon-button" title="Add to sale" data-action="cart-add" data-id="${p.id}">${icon("cart")}</button>
                  <button class="icon-button" title="Select label" data-action="label-toggle" data-id="${p.id}">${icon("tag")}</button>
                  <button class="icon-button" title="Edit" data-action="edit" data-id="${p.id}">${icon("edit")}</button>
                  <button class="icon-button" title="Delete" data-action="delete" data-id="${p.id}">${icon("trash")}</button>
                </div>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderSell(products) {
  const cartItems = Object.entries(state.cart)
    .map(([id, qty]) => ({ product: state.products.find((p) => p.id === id), qty }))
    .filter((x) => x.product);
  const subtotal = cartItems.reduce((sum, item) => sum + item.product.price * item.qty, 0);
  const cost = cartItems.reduce((sum, item) => sum + item.product.cost * item.qty, 0);

  return `
    <section class="workspace">
      <div class="panel">
        <div class="panel-head"><div><h3>Add items</h3><p>Use search or barcode text to find products.</p></div></div>
        ${renderFilters()}
        ${renderProductTable(products)}
      </div>
      <aside class="panel">
        <div class="panel-head"><div><h3>Current sale</h3><p>${cartItems.length} line items</p></div></div>
        <div class="checkout-list">
          ${cartItems.length ? cartItems.map(({ product, qty }) => checkoutItem(product, qty)).join("") : `<div class="empty">Add products to start a sale.</div>`}
        </div>
        <div class="cart-total">
          <div class="total-row"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>
          <div class="total-row"><span>Estimated margin</span><span>${money(subtotal - cost)}</span></div>
          <button class="primary-button" data-action="complete-sale" ${cartItems.length ? "" : "disabled"}>${icon("cart")}Complete sale</button>
          <button class="ghost-button" data-action="clear-cart">Clear</button>
        </div>
      </aside>
    </section>
  `;
}

function checkoutItem(product, qty) {
  return `
    <div class="mini-card checkout-item">
      <div><div class="product-name">${escapeHtml(product.name)}</div><span class="sku">${escapeHtml(product.sku)} · ${money(product.price)}</span></div>
      <div class="stepper">
        <button data-action="cart-minus" data-id="${product.id}">${icon("minus")}</button>
        <strong>${qty}</strong>
        <button data-action="cart-add" data-id="${product.id}">${icon("plus")}</button>
      </div>
    </div>
  `;
}

function renderLabels(products) {
  const selected = state.products.filter((p) => state.labelIds.has(p.id));
  return `
    <section class="workspace">
      <div class="panel">
        <div class="panel-head">
          <div><h3>Choose labels</h3><p>Select products, then print a sheet.</p></div>
          <button class="ghost-button" data-action="select-visible">${icon("plus")}Select visible</button>
        </div>
        ${renderFilters()}
        ${renderProductTable(products)}
      </div>
      <aside class="panel">
        <div class="panel-head">
          <div><h3>Preview</h3><p>${selected.length} products selected</p></div>
          <button class="primary-button" data-action="print-labels" ${selected.length ? "" : "disabled"}>${icon("print")}Print</button>
        </div>
        <div class="label-list">
          <div class="label-preview">
            ${selected.length ? selected.slice(0, 8).map(labelMarkup).join("") : `<div class="empty">No labels selected.</div>`}
          </div>
        </div>
      </aside>
    </section>
  `;
}

function labelMarkup(product) {
  return `
    <div class="print-label">
      <strong>${escapeHtml(product.name)}</strong>
      ${barcodeSvg(product.barcode, { height: 54, module: 1 })}
      <small>${escapeHtml(product.sku)} · ${money(product.price)}</small>
    </div>
  `;
}

function renderReports(t) {
  const recent = state.sales.slice().reverse().slice(0, 12);
  const topProducts = state.products
    .slice()
    .sort((a, b) => b.price * b.stock - a.price * a.stock)
    .slice(0, 6);
  return `
    <section class="workspace">
     <div class="panel">
        <div class="panel-head">
          <div><h3>Inventory value leaders</h3><p>Highest retail value currently on hand.</p></div>
          
            <button class="ghost-button" style="color:#D12300; margin-left:auto;" data-action="clear-sales">
                Clear All Sales
            </button>

            <button class="ghost-button" style="color:#D12300;" data-action="clear-all">
                Clear All Data
            </button>
        </div>
        <table>
          <thead><tr><th>Product</th><th>Units</th><th>Retail value</th><th>Cost basis</th></tr></thead>
          <tbody>
            ${topProducts.map((p) => `
              <tr>
                <td><div class="product-cell"><span class="swatch" style="${p.image ? "background:url('" + p.image + "') center/cover no-repeat" : "background:#333"}"></span><div><span class="product-name">${escapeHtml(p.name)}</span><span class="sku">${escapeHtml(p.sku)}</span></div></div></td>
                <td>${number(p.stock)}</td>
                <td>${money(p.stock * p.price)}</td>
                <td>${money(p.stock * p.cost)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <aside class="drawer">
        <section class="panel">
          <div class="panel-head"><div><h3>Snapshot</h3><p>Live totals</p></div></div>
          <div class="checkout-list">
            <div class="mini-card total-row"><span>Retail value</span><strong>${money(t.retail)}</strong></div>
            <div class="mini-card total-row"><span>Cost basis</span><strong>${money(t.cost)}</strong></div>
            <div class="mini-card total-row"><span>Projected margin</span><strong>${money(t.margin)}</strong></div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><div><h3>Recent sales</h3><p>Newest first</p></div></div>
          <div class="activity-list">
            ${recent.length ? recent.map((sale) => `<div class="mini-card activity-item"><div><div class="product-name">${escapeHtml(new Date(sale.date).toLocaleString())}</div><span class="sku">${sale.items.length} items</span></div><strong>${money(sale.total)}</strong></div>`).join("") : `<div class="empty">No sales recorded yet.</div>`}
          </div>
        </section>
      </aside>
    </section>
  `;
}

function bindEvents() {
  // Hamburger menu
  const hamburger = document.getElementById("hamburger-btn");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  function openSidebar() { sidebar?.classList.add("open"); overlay?.classList.add("open"); }
  function closeSidebar() { sidebar?.classList.remove("open"); overlay?.classList.remove("open"); }
  hamburger?.addEventListener("click", openSidebar);
  overlay?.addEventListener("click", closeSidebar);

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      closeSidebar();
      render();
    });
  });

  document.querySelectorAll("[data-input]").forEach((input) => {
    const eventName = input.dataset.input === "query" ? "input" : "change";
    input.addEventListener(eventName, () => {
      state[input.dataset.input] = input.value;
      if (input.dataset.input === "query") {
        clearTimeout(filterTimer);
        filterTimer = setTimeout(render, 140);
      } else {
        render();
      }
    });
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action, button.dataset.id));
  });
}

function handleAction(action, id) {
  if (action === "new-product") openProductModal();
  if (action === "edit") openProductModal(id);
  if (action === "delete") deleteProduct(id);
  if (action === "cart-add") addToCart(id);
  if (action === "cart-minus") removeFromCart(id);
  if (action === "clear-cart") {
    state.cart = {};
    render();
  }
  if (action === "complete-sale") completeSale();
  if (action === "label-toggle") toggleLabel(id);
  if (action === "select-visible") {
    filteredProducts().forEach((p) => state.labelIds.add(p.id));
    render();
  }
  if (action === "print-labels") printLabels();
  if (action === "export") exportData();
}

function nextBarcode() {
  const max = state.products.reduce((highest, p) => Math.max(highest, Number(p.barcode) || 100000000000), 100000000000);
  return String(max + 1);
}

function openProductModal(id) {
  const existing = state.products.find((p) => p.id === id);
  const product = existing || {
    name: "",
    sku: "",
    category: "",
    cost: 0,
    price: 0,
    stock: 0,
    reorder: 5,
    barcode: nextBarcode(),
    image: "",
    notes: "",
  };
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <form class="modal" id="product-form">
      <div class="panel-head"><div><h3>${existing ? "Edit product" : "New product"}</h3><p>Barcode is generated automatically, but you can replace it.</p></div></div>
      <div class="modal-body">
        <div class="form-grid">
          ${field("Name", "name", product.name, "text", true)}
          ${field("SKU", "sku", product.sku, "text", true)}
          ${field("Category", "category", product.category, "text", true)}
          ${field("Barcode", "barcode", product.barcode, "text", true)}
          ${field("Cost", "cost", product.cost, "number", true)}
          ${field("Price", "price", product.price, "number", true)}
          ${field("Stock", "stock", product.stock, "number", true)}
          ${field("Reorder level", "reorder", product.reorder, "number", true)}
          <div class="field full">
            <label>Product Image</label>
            <div class="image-upload-area" id="image-upload-area">
              ${product.image
                ? `<img src="${product.image}" class="image-preview" id="image-preview" alt="Product"/>`
                : `<div class="image-placeholder" id="image-placeholder">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                    <span>Click or drag to upload image</span>
                    <small>PNG, JPG, WEBP supported</small>
                  </div>`
              }
            </div>
            <input type="file" id="image-file-input" accept="image/*" style="display:none"/>
            <input type="hidden" name="image" id="image-hidden" value="${escapeHtml(product.image || "")}"/>
            ${product.image ? `<button type="button" class="ghost-button" id="remove-image-btn" style="margin-top:8px; width:100%;">Remove image</button>` : ""}
          </div>
          <div class="field full"><label>Notes</label><textarea class="textarea" name="notes">${escapeHtml(product.notes)}</textarea></div>
          <div class="field full"><label>Preview</label><div class="barcode-wrap">${barcodeSvg(product.barcode)}</div></div>
        </div>
      </div>
      <div class="modal-foot">
        <button type="button" class="ghost-button" data-close>Cancel</button>
        <button type="submit" class="primary-button">Save product</button>
      </div>
    </form>
  `;
  document.body.appendChild(modal);
  modal.querySelector("[data-close]").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });
  modal.querySelector("[name='barcode']").addEventListener("input", (event)) => {
    modal.querySelector(".barcode-wrap").innerHTML = barcodeSvg(event.target.value);
  }
  // ===== FIX: CLEAR SALES =====
if (action === "clear-sales") {
  if (!confirm("Delete ALL sales permanently?")) return;

  state.sales = [];
  localStorage.removeItem(SALES_KEY);

  db.collection("sales").get().then((snap) => {
    const batch = db.batch();
    snap.forEach((doc) => batch.delete(doc.ref));
    return batch.commit();
  }).then(() => {
    render();
    toast("All sales deleted");
  });
}

// ===== FIX: CLEAR ALL =====
if (action === "clear-all") {
  if (!confirm("Delete EVERYTHING permanently?")) return;

  state.products = [];
  state.sales = [];
  state.cart = {};

  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SALES_KEY);

  Promise.all([
    db.collection("products").get(),
    db.collection("sales").get()
  ]).then(([prodSnap, salesSnap]) => {
    const batch = db.batch();
    prodSnap.forEach(doc => batch.delete(doc.ref));
    salesSnap.forEach(doc => batch.delete(doc.ref));
    return batch.commit();
  }).then(() => {
    render();
    toast("All data cleared");
  });
}

  // Image upload logic
  const uploadArea = modal.querySelector("#image-upload-area");
  const fileInput = modal.querySelector("#image-file-input");
  const hiddenInput = modal.querySelector("#image-hidden");

  function applyImage(base64) {
    hiddenInput.value = base64;
    uploadArea.innerHTML = `<img src="${base64}" class="image-preview" id="image-preview" alt="Product"/>`;
    let removeBtn = modal.querySelector("#remove-image-btn");
    if (!removeBtn) {
      removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "ghost-button";
      removeBtn.id = "remove-image-btn";
      removeBtn.style = "margin-top:8px; width:100%;";
      removeBtn.textContent = "Remove image";
      uploadArea.parentElement.insertBefore(removeBtn, uploadArea.nextSibling);
    }
    removeBtn.onclick = () => {
      hiddenInput.value = "";
      uploadArea.innerHTML = `<div class="image-placeholder" id="image-placeholder">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
        <span>Click or drag to upload image</span>
        <small>PNG, JPG, WEBP supported</small>
      </div>`;
      removeBtn.remove();
    };
  }

  uploadArea.addEventListener("click", () => fileInput.click());
  uploadArea.addEventListener("dragover", (e) => { e.preventDefault(); uploadArea.classList.add("drag-over"); });
  uploadArea.addEventListener("dragleave", () => uploadArea.classList.remove("drag-over"));
  uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) readImageFile(file);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) readImageFile(fileInput.files[0]);
  });

  function readImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => applyImage(e.target.result);
    reader.readAsDataURL(file);
  }

  // Wire up existing remove button if editing a product that already has an image
  const existingRemoveBtn = modal.querySelector("#remove-image-btn");
  if (existingRemoveBtn) {
    existingRemoveBtn.onclick = () => {
      hiddenInput.value = "";
      uploadArea.innerHTML = `<div class="image-placeholder">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
        <span>Click or drag to upload image</span>
        <small>PNG, JPG, WEBP supported</small>
      </div>`;
      existingRemoveBtn.remove();
    };
  }
  modal.querySelector("#product-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = {
      id: existing?.id || uid(),
      name: data.get("name").trim(),
      sku: data.get("sku").trim(),
      category: data.get("category").trim(),
      barcode: data.get("barcode").trim(),
      cost: Math.max(0, Number(data.get("cost")) || 0),
      price: Math.max(0, Number(data.get("price")) || 0),
      stock: Math.max(0, Math.floor(Number(data.get("stock")) || 0)),
      reorder: Math.max(0, Math.floor(Number(data.get("reorder")) || 0)),
      image: data.get("image") || "",
      notes: data.get("notes").trim(),
    };
    if (!next.name || !next.sku || !next.barcode) return toast("Name, SKU, and barcode are required.");
    if (existing) {
      state.products = state.products.map((p) => (p.id === existing.id ? next : p));
    } else {
      state.products.unshift(next);
    }
    save();
    modal.remove();
    render();
    toast("Product saved");
  });
}

function field(label, name, value, type, required) {
  return `<div class="field"><label>${label}</label><input class="input" name="${name}" type="${type}" value="${escapeHtml(value)}" ${required ? "required" : ""} ${type === "number" ? "step='0.01'" : ""}/></div>`;
}

function deleteProduct(id) {
  const product = state.products.find((p) => p.id === id);
  if (!product || !confirm(`Delete ${product.name}?`)) return;
  state.products = state.products.filter((p) => p.id !== id);
  delete state.cart[id];
  state.labelIds.delete(id);
  save();
  render();
  toast("Product deleted");
}

function addToCart(id) {
  const product = state.products.find((p) => p.id === id);
  if (!product) return;
  const current = state.cart[id] || 0;
  if (current >= product.stock) return toast("Not enough stock available");
  state.cart[id] = current + 1;
  if (state.tab !== "sell") state.tab = "sell";
  render();
}

function removeFromCart(id) {
  if (!state.cart[id]) return;
  state.cart[id] -= 1;
  if (state.cart[id] <= 0) delete state.cart[id];
  render();
}

function completeSale() {
  const items = Object.entries(state.cart)
    .map(([id, qty]) => ({ product: state.products.find((p) => p.id === id), qty }))
    .filter((item) => item.product && item.qty > 0);
  if (!items.length) return;
  if (items.some((item) => item.qty > item.product.stock)) return toast("A cart item exceeds stock");
  const sale = {
    id: uid(),
    date: new Date().toISOString(),
    items: items.map((item) => ({
      id: item.product.id,
      name: item.product.name,
      sku: item.product.sku,
      qty: item.qty,
      price: item.product.price,
      cost: item.product.cost,
    })),
    total: items.reduce((sum, item) => sum + item.qty * item.product.price, 0),
    cost: items.reduce((sum, item) => sum + item.qty * item.product.cost, 0),
  };
  state.products = state.products.map((product) => {
    const item = items.find((x) => x.product.id === product.id);
    return item ? { ...product, stock: product.stock - item.qty } : product;
  });
  state.sales.push(sale);
  state.cart = {};
  save();
  render();
  toast("Sale completed and inventory updated");
}

function toggleLabel(id) {
  if (state.labelIds.has(id)) state.labelIds.delete(id);
  else state.labelIds.add(id);
  if (state.tab !== "labels") state.tab = "labels";
  render();
}

function printLabels() {
  const selected = state.products.filter((p) => state.labelIds.has(p.id));
  document.querySelector("#print-area").innerHTML = selected.map(labelMarkup).join("");
  window.print();
}

function exportData() {
  const blob = new Blob([JSON.stringify({ products: state.products, sales: state.sales }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `stockroom-export-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

load().then(() => render());

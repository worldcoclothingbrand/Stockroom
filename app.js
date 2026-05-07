const STORAGE_KEY   = "stockroom.inventory.v1";
const SALES_KEY     = "stockroom.sales.v1";
const ALLOWED_EMAIL = "worldcoclothingbrand@gmail.com";

// ── Firebase ──────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDdoRoZfBWZWb8G0MExsbD4KarmB8qZG6c",
  authDomain: "stockroom-a48c3.firebaseapp.com",
  projectId: "stockroom-a48c3",
  storageBucket: "stockroom-a48c3.firebasestorage.app",
  messagingSenderId: "629513576568",
  appId: "1:629513576568:web:ca15a5bed03c4877e34d8d"
};
firebase.initializeApp(firebaseConfig);
const db       = firebase.firestore();
const auth     = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();
// ─────────────────────────────────────────────────────────

let filterTimer;
let currentUser = null;

const state = {
  tab: "inventory",
  query: "",
  category: "All",
  status: "All",
  products: [],
  sales: [],
  cart: {},
  labelIds: new Set(),
};

function uid() {
  return globalThis.crypto && globalThis.crypto.randomUUID
    ? globalThis.crypto.randomUUID()
    : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function showLogin(errorMsg) {
  document.body.innerHTML =
    '<div class="login-screen">' +
      '<div class="login-card">' +
        '<div class="login-mark">S</div>' +
        '<h1 class="login-title">Stockroom</h1>' +
        '<p class="login-sub">Enter your access code</p>' +
        (errorMsg ? '<p class="login-error">' + errorMsg + '</p>' : "") +
        '<input id="pin-input" type="password" class="input" placeholder="Access code" style="margin-top:12px;" autocomplete="current-password"/>' +
        '<button id="pin-btn" class="login-btn" style="margin-top:10px;">Enter Stockroom</button>' +
      '</div>' +
    '</div>';

  var inp = document.getElementById("pin-input");
  var btn = document.getElementById("pin-btn");

  function tryPin() {
    var val = inp.value;
    if (!val) return;
    hashPin(val).then(function(h) {
      if (h === PIN_HASH) {
        localStorage.setItem(AUTH_KEY, PIN_HASH);
        startApp();
      } else {
        showLogin("Incorrect code. Try again.");
      }
    });
  }

// ── Data ──────────────────────────────────────────────────

async function load() {
  try {
    const ps = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const ss = JSON.parse(localStorage.getItem(SALES_KEY)   || "[]");
    if (Array.isArray(ps) && ps.length) state.products = ps;
    if (Array.isArray(ss))              state.sales    = ss;
  } catch (e) {}

  try {
    const [pSnap, sSnap] = await Promise.all([
      db.collection("products").get(),
      db.collection("sales").get(),
    ]);
    if (!pSnap.empty) state.products = pSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    if (!sSnap.empty) state.sales    = sSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.products));
    localStorage.setItem(SALES_KEY,   JSON.stringify(state.sales));
  } catch (e) {
    console.log("Firebase unavailable, using local data");
  }
}

async function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.products));
  localStorage.setItem(SALES_KEY,   JSON.stringify(state.sales));
  try {
    for (const p of state.products) await db.collection("products").doc(p.id).set(p);
    for (const s of state.sales)    await db.collection("sales").doc(s.id).set(s);
  } catch (e) { console.log("Firebase save failed:", e); }
}

async function deleteProduct(id) {
  const p = state.products.find(p => p.id === id);
  if (!p || !confirm("Delete " + p.name + "?")) return;
  state.products = state.products.filter(p => p.id !== id);
  delete state.cart[id];
  state.labelIds.delete(id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.products));
  try { await db.collection("products").doc(id).delete(); } catch (e) {}
  render();
  toast("Product deleted");
}

async function clearAllSales() {
  if (!confirm("Delete ALL sales history permanently?")) return;
  state.sales = [];
  localStorage.removeItem(SALES_KEY);
  try {
    const snap  = await db.collection("sales").get();
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  } catch (e) {}
  render();
  toast("All sales cleared");
}

async function clearAllData() {
  if (!confirm("WARNING: Delete ALL products AND sales permanently?")) return;
  state.products = []; state.sales = []; state.cart = {}; state.labelIds = new Set();
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SALES_KEY);
  try {
    const [pSnap, sSnap] = await Promise.all([
      db.collection("products").get(),
      db.collection("sales").get(),
    ]);
    const batch = db.batch();
    pSnap.docs.forEach(doc => batch.delete(doc.ref));
    sSnap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  } catch (e) {}
  render();
  toast("All data cleared");
}

// ── Helpers ───────────────────────────────────────────────

function money(v)  { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(v || 0)); }
function number(v) { return new Intl.NumberFormat("en-US").format(Number(v || 0)); }

function escapeHtml(v) {
  return String(v == null ? "" : v)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function totals() {
  const retail  = state.products.reduce((s, p) => s + p.price * p.stock, 0);
  const cost    = state.products.reduce((s, p) => s + p.cost  * p.stock, 0);
  const units   = state.products.reduce((s, p) => s + p.stock, 0);
  const low     = state.products.filter(p => p.stock <= p.reorder).length;
  const revenue = state.sales.reduce((s, sale) => s + sale.total, 0);
  return { retail, cost, units, low, revenue, margin: retail - cost };
}

function categories() {
  return ["All", ...Array.from(new Set(state.products.map(p => p.category).filter(Boolean))).sort()];
}

function filteredProducts() {
  const q = state.query.trim().toLowerCase();
  return state.products.filter(p => {
    const mQ = !q || [p.name, p.sku, p.category, p.barcode].some(x => String(x).toLowerCase().includes(q));
    const mC = state.category === "All" || p.category === state.category;
    const mS = state.status === "All" ||
      (state.status === "In stock" && p.stock > p.reorder) ||
      (state.status === "Low"      && p.stock > 0 && p.stock <= p.reorder) ||
      (state.status === "Out"      && p.stock === 0);
    return mQ && mC && mS;
  });
}

function productStatus(p) {
  if (p.stock === 0)        return { label: "Out",     className: "out" };
  if (p.stock <= p.reorder) return { label: "Low",     className: "low" };
  return                           { label: "In stock", className: ""   };
}

// ── Barcode ───────────────────────────────────────────────

function barcodeSvg(value, opts) {
  opts = opts || {};
  const text   = String(value || "").slice(0, 32);
  const height = opts.height || 72;
  const mod    = opts.module || 1.35;
  const quiet  = 10;
  const P = [
    "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
    "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
    "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
    "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
    "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
    "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
    "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
    "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
    "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
    "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
    "114131","311141","411131","211412","211214","211232","2331112",
  ];
  const codes = [104];
  for (const ch of text) { const c = ch.charCodeAt(0); codes.push(c >= 32 && c <= 126 ? c - 32 : 0); }
  let checksum = codes[0];
  for (let i = 1; i < codes.length; i++) checksum += codes[i] * i;
  codes.push(checksum % 103, 106);
  let x = quiet;
  const bars = [];
  for (const code of codes) {
    const pat = P[code];
    for (let i = 0; i < pat.length; i++) {
      const w = Number(pat[i]) * mod;
      if (i % 2 === 0) bars.push('<rect x="' + x.toFixed(2) + '" y="0" width="' + w.toFixed(2) + '" height="' + height + '" fill="#000"/>');
      x += w;
    }
  }
  const W = x + quiet;
  return '<svg viewBox="0 0 ' + W.toFixed(2) + ' ' + (height + 19) + '" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/>' + bars.join("") + '<text x="' + (W / 2) + '" y="' + (height + 14) + '" fill="#000" font-size="10" font-family="monospace" text-anchor="middle">' + escapeHtml(text) + '</text></svg>';
}

// ── Icons ─────────────────────────────────────────────────

function icon(name) {
  const I = {
    box:      "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z M3.3 7 12 12l8.7-5 M12 22V12",
    plus:     "M12 5v14 M5 12h14",
    cart:     "M6 6h15l-1.5 8.5a2 2 0 0 1-2 1.5H9a2 2 0 0 1-2-1.6L5 3H2 M9 21h.01 M18 21h.01",
    barcode:  "M3 5v14 M7 5v14 M10 5v14 M14 5v14 M17 5v14 M21 5v14",
    chart:    "M3 3v18h18 M8 17V9 M13 17V5 M18 17v-7",
    tag:      "M20.6 13.1 13 20.7a2 2 0 0 1-2.8 0L3.3 13.8a2 2 0 0 1-.6-1.4V5a2 2 0 0 1 2-2h7.4a2 2 0 0 1 1.4.6l7.1 7.1a2 2 0 0 1 0 2.8Z M7.5 7.5h.01",
    edit:     "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
    trash:    "M3 6h18 M8 6V4h8v2 M6 6l1 15h10l1-15",
    print:    "M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z",
    minus:    "M5 12h14",
    download: "M12 3v12 M7 10l5 5 5-5 M5 21h14",
    menu:     "M3 6h18 M3 12h18 M3 18h18",
    logout:   "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  };
  return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + I[name] + '"/></svg>';
}

// ── Render ────────────────────────────────────────────────

function render() {
  const app = document.querySelector("#app");
  if (!app) return;
  const t   = totals();
  const vis = filteredProducts();

  app.innerHTML =
    '<button class="hamburger" id="hamburger-btn" aria-label="Open menu">' + icon("menu") + '</button>' +
    '<div class="sidebar-overlay" id="sidebar-overlay"></div>' +
    '<div class="shell">' +
      '<aside class="sidebar" id="sidebar">' +
        '<div class="brand"><div class="mark">S</div><div><h1>Stockroom</h1><p>Inventory, barcodes &amp; sales</p></div></div>' +
        '<nav class="nav">' +
          navBtn("inventory", "box",     "Inventory") +
          navBtn("sell",      "cart",    "Sell") +
          navBtn("labels",    "barcode", "Labels") +
          navBtn("reports",   "chart",   "Reports") +
        '</nav>' +
        '<div class="side-card">' +
          '<p class="side-note">Signed in as<br><strong style="color:#fff;word-break:break-all;">' + escapeHtml(currentUser ? currentUser.email : "") + '</strong></p>' +
          '<button class="ghost-button" data-action="signout" style="margin-top:10px;width:100%;">' + icon("logout") + 'Sign out</button>' +
        '</div>' +
      '</aside>' +
      '<main class="main">' +
        '<div class="topbar">' +
          '<div class="title-block"><h2>' + pageTitle() + '</h2><p>' + pageSubtitle() + '</p></div>' +
          '<div class="actions">' +
            '<button class="ghost-button" data-action="export">' + icon("download") + 'Export JSON</button>' +
            '<button class="primary-button" data-action="new-product">' + icon("plus") + 'New product</button>' +
          '</div>' +
        '</div>' +
        renderStats(t) +
        (state.tab === "inventory" ? renderInventory(vis) : "") +
        (state.tab === "sell"      ? renderSell(vis)      : "") +
        (state.tab === "labels"    ? renderLabels(vis)    : "") +
        (state.tab === "reports"   ? renderReports(t)     : "") +
      '</main>' +
    '</div>' +
    '<div id="print-area"></div>';

  bindEvents();
}

function navBtn(tab, icn, label) {
  return '<button class="' + (state.tab === tab ? "active" : "") + '" data-tab="' + tab + '"><span class="nav-icon">' + icon(icn) + '</span>' + label + '</button>';
}

function pageTitle() {
  return { inventory: "Inventory", sell: "Checkout", labels: "Barcode labels", reports: "Reports" }[state.tab];
}

function pageSubtitle() {
  return {
    inventory: "Add products, track stock, and watch value in real time.",
    sell:      "Ring up sales and inventory updates instantly.",
    labels:    "Generate scannable Code 128 labels for any product.",
    reports:   "Simple sales and value snapshots for your stock.",
  }[state.tab];
}

function renderStats(t) {
  return '<section class="grid stats">' +
    '<div class="stat"><small>Retail inventory value</small><strong>' + money(t.retail)  + '</strong><span>' + money(t.margin) + ' projected margin</span></div>' +
    '<div class="stat"><small>Units in stock</small><strong>'          + number(t.units)  + '</strong><span>' + state.products.length + ' products</span></div>' +
    '<div class="stat"><small>Low stock</small><strong>'               + number(t.low)    + '</strong><span>At or below reorder level</span></div>' +
    '<div class="stat"><small>Total sales</small><strong>'             + money(t.revenue) + '</strong><span>' + state.sales.length + ' checkouts</span></div>' +
  '</section>';
}

function renderFilters() {
  const cats = categories().map(c => '<option ' + (state.category === c ? "selected" : "") + '>' + escapeHtml(c) + '</option>').join("");
  const sts  = ["All","In stock","Low","Out"].map(s => '<option ' + (state.status === s ? "selected" : "") + '>' + s + '</option>').join("");
  return '<div class="search-row">' +
    '<input class="input" data-input="query" value="' + escapeHtml(state.query) + '" placeholder="Search products, SKU, barcode"/>' +
    '<select class="select" data-input="category">' + cats + '</select>' +
    '<select class="select" data-input="status">'   + sts  + '</select>' +
  '</div>';
}

function renderInventory(products) {
  return '<section class="panel">' +
    '<div class="panel-head"><div><h3>Products</h3><p>' + products.length + ' shown from ' + state.products.length + ' total</p></div></div>' +
    renderFilters() + renderProductTable(products) +
  '</section>';
}

function renderProductTable(products) {
  if (!products.length) return '<div class="empty">No matching products yet.</div>';
  const rows = products.map(p => {
    const st = productStatus(p);
    return '<tr>' +
      '<td><div class="product-cell">' +
        '<span class="swatch" style="background:' + escapeHtml(p.color || "#333") + '"></span>' +
        '<div><span class="product-name">' + escapeHtml(p.name) + '</span><span class="sku">' + escapeHtml(p.sku) + '</span></div>' +
      '</div></td>' +
      '<td class="hide-mobile">' + escapeHtml(p.category) + '</td>' +
      '<td><span class="pill ' + st.className + '">' + number(p.stock) + ' &middot; ' + st.label + '</span></td>' +
      '<td>' + money(p.price) + '</td>' +
      '<td class="hide-mobile">' + money(p.price * p.stock) + '</td>' +
      '<td class="hide-mobile"><span class="sku">' + escapeHtml(p.barcode) + '</span></td>' +
      '<td><div class="table-actions">' +
        '<button class="icon-button" title="Add to sale"  data-action="cart-add"     data-id="' + p.id + '">' + icon("cart")  + '</button>' +
        '<button class="icon-button" title="Label"        data-action="label-toggle" data-id="' + p.id + '">' + icon("tag")   + '</button>' +
        '<button class="icon-button" title="Edit"         data-action="edit"         data-id="' + p.id + '">' + icon("edit")  + '</button>' +
        '<button class="icon-button" title="Delete"       data-action="delete"       data-id="' + p.id + '">' + icon("trash") + '</button>' +
      '</div></td>' +
    '</tr>';
  }).join("");
  return '<div class="table-wrap"><table>' +
    '<thead><tr>' +
      '<th>Product</th>' +
      '<th class="hide-mobile">Category</th>' +
      '<th>Stock</th><th>Price</th>' +
      '<th class="hide-mobile">Value</th>' +
      '<th class="hide-mobile">Barcode</th>' +
      '<th></th>' +
    '</tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
  '</table></div>';
}

function renderSell(products) {
  const cartItems = Object.entries(state.cart)
    .map(([id, qty]) => ({ product: state.products.find(p => p.id === id), qty }))
    .filter(x => x.product);
  const subtotal = cartItems.reduce((s, i) => s + i.product.price * i.qty, 0);
  const cost     = cartItems.reduce((s, i) => s + i.product.cost  * i.qty, 0);
  const items    = cartItems.length
    ? cartItems.map(i => checkoutItem(i.product, i.qty)).join("")
    : '<div class="empty">Add products to start a sale.</div>';
  return '<section class="workspace">' +
    '<div class="panel"><div class="panel-head"><div><h3>Add items</h3><p>Search to find products.</p></div></div>' +
    renderFilters() + renderProductTable(products) + '</div>' +
    '<aside class="panel">' +
      '<div class="panel-head"><div><h3>Current sale</h3><p>' + cartItems.length + ' items</p></div></div>' +
      '<div class="checkout-list">' + items + '</div>' +
      '<div class="cart-total">' +
        '<div class="total-row"><span>Subtotal</span><strong>' + money(subtotal) + '</strong></div>' +
        '<div class="total-row"><span>Est. margin</span><span>' + money(subtotal - cost) + '</span></div>' +
        '<button class="primary-button" data-action="complete-sale" ' + (cartItems.length ? "" : "disabled") + '>' + icon("cart") + 'Complete sale</button>' +
        '<button class="ghost-button" data-action="clear-cart">Clear</button>' +
      '</div>' +
    '</aside>' +
  '</section>';
}

function checkoutItem(product, qty) {
  return '<div class="mini-card checkout-item">' +
    '<div><div class="product-name">' + escapeHtml(product.name) + '</div><span class="sku">' + escapeHtml(product.sku) + ' &middot; ' + money(product.price) + '</span></div>' +
    '<div class="stepper">' +
      '<button data-action="cart-minus" data-id="' + product.id + '">' + icon("minus") + '</button>' +
      '<strong>' + qty + '</strong>' +
      '<button data-action="cart-add"   data-id="' + product.id + '">' + icon("plus")  + '</button>' +
    '</div>' +
  '</div>';
}

function renderLabels(products) {
  const selected    = state.products.filter(p => state.labelIds.has(p.id));
  const previewHtml = selected.length
    ? selected.slice(0, 8).map(labelMarkup).join("")
    : '<div class="empty">No labels selected.</div>';
  return '<section class="workspace">' +
    '<div class="panel">' +
      '<div class="panel-head"><div><h3>Choose labels</h3><p>Select then print.</p></div>' +
      '<button class="ghost-button" data-action="select-visible">' + icon("plus") + 'Select visible</button></div>' +
      renderFilters() + renderProductTable(products) +
    '</div>' +
    '<aside class="panel">' +
      '<div class="panel-head"><div><h3>Preview</h3><p>' + selected.length + ' selected</p></div>' +
      '<button class="primary-button" data-action="print-labels" ' + (selected.length ? "" : "disabled") + '>' + icon("print") + 'Print</button></div>' +
      '<div class="label-list"><div class="label-preview">' + previewHtml + '</div></div>' +
    '</aside>' +
  '</section>';
}

function labelMarkup(p) {
  return '<div class="print-label"><strong>' + escapeHtml(p.name) + '</strong>' + barcodeSvg(p.barcode, { height: 54, module: 1 }) + '<small>' + escapeHtml(p.sku) + ' &middot; ' + money(p.price) + '</small></div>';
}

function renderReports(t) {
  const recent = state.sales.slice().reverse().slice(0, 12);
  const top    = state.products.slice().sort((a, b) => b.price * b.stock - a.price * a.stock).slice(0, 6);
  const topRows = top.map(p =>
    '<tr>' +
    '<td><div class="product-cell"><span class="swatch" style="background:' + escapeHtml(p.color || "#333") + '"></span>' +
    '<div><span class="product-name">' + escapeHtml(p.name) + '</span><span class="sku">' + escapeHtml(p.sku) + '</span></div></div></td>' +
    '<td>' + number(p.stock) + '</td><td>' + money(p.stock * p.price) + '</td><td>' + money(p.stock * p.cost) + '</td></tr>'
  ).join("");
  const recentHtml = recent.length ? recent.map(sale =>
    '<div class="mini-card activity-item"><div><div class="product-name">' + escapeHtml(new Date(sale.date).toLocaleString()) + '</div>' +
    '<span class="sku">' + sale.items.length + ' items</span></div><strong>' + money(sale.total) + '</strong></div>'
  ).join("") : '<div class="empty">No sales yet.</div>';

  return '<section class="workspace">' +
    '<div class="panel">' +
      '<div class="panel-head">' +
        '<div><h3>Inventory value leaders</h3><p>Highest retail value on hand.</p></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="ghost-button" style="color:#ff5c7a;" data-action="clear-all-sales">Clear Sales</button>' +
          '<button class="ghost-button" style="color:#ff5c7a;" data-action="clear-all-data">Clear All Data</button>' +
        '</div>' +
      '</div>' +
      '<div class="table-wrap"><table><thead><tr><th>Product</th><th>Units</th><th>Retail</th><th>Cost</th></tr></thead><tbody>' + topRows + '</tbody></table></div>' +
    '</div>' +
    '<aside class="drawer">' +
      '<section class="panel"><div class="panel-head"><div><h3>Snapshot</h3><p>Live totals</p></div></div>' +
        '<div class="checkout-list">' +
          '<div class="mini-card total-row"><span>Retail value</span><strong>'     + money(t.retail)  + '</strong></div>' +
          '<div class="mini-card total-row"><span>Cost basis</span><strong>'       + money(t.cost)    + '</strong></div>' +
          '<div class="mini-card total-row"><span>Projected margin</span><strong>' + money(t.margin)  + '</strong></div>' +
        '</div>' +
      '</section>' +
      '<section class="panel"><div class="panel-head"><div><h3>Recent sales</h3><p>Newest first</p></div></div>' +
        '<div class="activity-list">' + recentHtml + '</div>' +
      '</section>' +
    '</aside>' +
  '</section>';
}

// ── Events ────────────────────────────────────────────────

function bindEvents() {
  const hamburger = document.getElementById("hamburger-btn");
  const sidebar   = document.getElementById("sidebar");
  const overlay   = document.getElementById("sidebar-overlay");

  function openSidebar()  { sidebar && sidebar.classList.add("open");    overlay && overlay.classList.add("open"); }
  function closeSidebar() { sidebar && sidebar.classList.remove("open"); overlay && overlay.classList.remove("open"); }

  if (hamburger) hamburger.addEventListener("click", openSidebar);
  if (overlay)   overlay.addEventListener("click", closeSidebar);

  document.querySelectorAll("[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => { state.tab = btn.dataset.tab; closeSidebar(); render(); });
  });

  document.querySelectorAll("[data-input]").forEach(input => {
    const ev = input.dataset.input === "query" ? "input" : "change";
    input.addEventListener(ev, () => {
      state[input.dataset.input] = input.value;
      if (input.dataset.input === "query") { clearTimeout(filterTimer); filterTimer = setTimeout(render, 140); }
      else render();
    });
  });

  document.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => handleAction(btn.dataset.action, btn.dataset.id));
  });
}

function handleAction(action, id) {
  if (action === "new-product")     openProductModal();
  if (action === "edit")            openProductModal(id);
  if (action === "delete")          deleteProduct(id);
  if (action === "cart-add")        addToCart(id);
  if (action === "cart-minus")      removeFromCart(id);
  if (action === "clear-cart")      { state.cart = {}; render(); }
  if (action === "complete-sale")   completeSale();
  if (action === "label-toggle")    toggleLabel(id);
  if (action === "select-visible")  { filteredProducts().forEach(p => state.labelIds.add(p.id)); render(); }
  if (action === "print-labels")    printLabels();
  if (action === "export")          exportData();
  if (action === "clear-all-sales") clearAllSales();
  if (action === "clear-all-data")  clearAllData();
  if (action === "signout")         auth.signOut();
}

// ── Product modal ─────────────────────────────────────────

function nextBarcode() {
  const max = state.products.reduce((h, p) => Math.max(h, Number(p.barcode) || 100000000000), 100000000000);
  return String(max + 1);
}

function field(label, name, value, type, required) {
  return '<div class="field"><label>' + label + '</label><input class="input' + (type === "color" ? " color-input" : "") + '" name="' + name + '" type="' + type + '" value="' + escapeHtml(value) + '" ' + (required ? "required" : "") + ' ' + (type === "number" ? "step='0.01'" : "") + '/></div>';
}

function openProductModal(id) {
  const existing = state.products.find(p => p.id === id);
  const product  = existing || { name: "", sku: "", category: "", cost: 0, price: 0, stock: 0, reorder: 5, barcode: nextBarcode(), color: "#ffffff", notes: "" };

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML =
    '<form class="modal" id="product-form">' +
      '<div class="panel-head"><div><h3>' + (existing ? "Edit product" : "New product") + '</h3><p>Barcode auto-generated, editable.</p></div></div>' +
      '<div class="modal-body"><div class="form-grid">' +
        field("Name",          "name",     product.name,     "text",   true)  +
        field("SKU",           "sku",      product.sku,      "text",   true)  +
        field("Category",      "category", product.category, "text",   false) +
        field("Barcode",       "barcode",  product.barcode,  "text",   true)  +
        field("Cost",          "cost",     product.cost,     "number", true)  +
        field("Price",         "price",    product.price,    "number", true)  +
        field("Stock",         "stock",    product.stock,    "number", true)  +
        field("Reorder level", "reorder",  product.reorder,  "number", true)  +
        field("Color",         "color",    product.color || "#ffffff", "color", false) +
        '<div class="field full"><label>Notes</label><textarea class="textarea" name="notes">' + escapeHtml(product.notes) + '</textarea></div>' +
        '<div class="field full"><label>Barcode preview</label><div class="barcode-wrap">' + barcodeSvg(product.barcode) + '</div></div>' +
      '</div></div>' +
      '<div class="modal-foot">' +
        '<button type="button" class="ghost-button" data-close>Cancel</button>' +
        '<button type="submit" class="primary-button">Save product</button>' +
      '</div>' +
    '</form>';

  document.body.appendChild(modal);

  modal.querySelector("[data-close]").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  modal.querySelector("[name='barcode']").addEventListener("input", e => {
    modal.querySelector(".barcode-wrap").innerHTML = barcodeSvg(e.target.value);
  });

  modal.querySelector("#product-form").addEventListener("submit", e => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const next = {
      id:       existing ? existing.id : uid(),
      name:     data.get("name").trim(),
      sku:      data.get("sku").trim(),
      category: data.get("category").trim(),
      barcode:  data.get("barcode").trim(),
      cost:     Math.max(0, Number(data.get("cost"))   || 0),
      price:    Math.max(0, Number(data.get("price"))  || 0),
      stock:    Math.max(0, Math.floor(Number(data.get("stock"))   || 0)),
      reorder:  Math.max(0, Math.floor(Number(data.get("reorder")) || 0)),
      color:    data.get("color") || "#ffffff",
      notes:    data.get("notes").trim(),
    };
    if (!next.name || !next.sku || !next.barcode) return toast("Name, SKU, and barcode are required.");
    if (existing) state.products = state.products.map(p => p.id === existing.id ? next : p);
    else state.products.unshift(next);
    save(); modal.remove(); render(); toast("Product saved");
  });
}

// ── Cart / Sales ──────────────────────────────────────────

function addToCart(id) {
  const p = state.products.find(p => p.id === id);
  if (!p) return;
  const cur = state.cart[id] || 0;
  if (cur >= p.stock) return toast("Not enough stock");
  state.cart[id] = cur + 1;
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
    .map(([id, qty]) => ({ product: state.products.find(p => p.id === id), qty }))
    .filter(i => i.product && i.qty > 0);
  if (!items.length) return;
  if (items.some(i => i.qty > i.product.stock)) return toast("A cart item exceeds stock");
  const sale = {
    id:    uid(),
    date:  new Date().toISOString(),
    items: items.map(i => ({ id: i.product.id, name: i.product.name, sku: i.product.sku, qty: i.qty, price: i.product.price, cost: i.product.cost })),
    total: items.reduce((s, i) => s + i.qty * i.product.price, 0),
    cost:  items.reduce((s, i) => s + i.qty * i.product.cost,  0),
  };
  state.products = state.products.map(p => {
    const item = items.find(i => i.product.id === p.id);
    return item ? Object.assign({}, p, { stock: p.stock - item.qty }) : p;
  });
  state.sales.push(sale);
  state.cart = {};
  save(); render(); toast("Sale completed");
}

// ── Labels ────────────────────────────────────────────────

function toggleLabel(id) {
  if (state.labelIds.has(id)) state.labelIds.delete(id); else state.labelIds.add(id);
  if (state.tab !== "labels") state.tab = "labels";
  render();
}

function printLabels() {
  const selected = state.products.filter(p => state.labelIds.has(p.id));
  document.querySelector("#print-area").innerHTML = selected.map(labelMarkup).join("");
  window.print();
}

// ── Export ────────────────────────────────────────────────

function exportData() {
  const blob = new Blob([JSON.stringify({ products: state.products, sales: state.sales }, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "stockroom-export-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click(); URL.revokeObjectURL(url);
}

// ── Toast ─────────────────────────────────────────────────

function toast(msg) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

}
      
    });
  }

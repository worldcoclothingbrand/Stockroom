const STORAGE_KEY = "stockroom.inventory.v1";
const SALES_KEY = "stockroom.sales.v1";
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

const db = firebase.firestore();
const auth = firebase.auth();

const provider = new firebase.auth.GoogleAuthProvider();
provider.setCustomParameters({
  prompt: "select_account"
});

let filterTimer = null;
let currentUser = null;

// ── App State ─────────────────────────────────────────────
const state = {
  tab: "inventory",
  query: "",
  category: "All",
  status: "All",
  products: [],
  sales: [],
  cart: {},
  labelIds: new Set()
};

// ── Utils ─────────────────────────────────────────────────
function uid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function money(v) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(v || 0));
}

function number(v) {
  return new Intl.NumberFormat("en-US").format(Number(v || 0));
}

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function ensureApp() {
  let app = document.getElementById("app");

  if (!app) {
    app = document.createElement("div");
    app.id = "app";
    document.body.appendChild(app);
  }

  return app;
}

// ── Auth ──────────────────────────────────────────────────
async function startAuth() {
  console.log("START AUTH");

  const app = ensureApp();

  app.innerHTML =
    '<div class="login-screen">' +
      '<div class="login-card">' +
        '<div class="login-mark">S</div>' +
        '<h1 class="login-title">Stockroom</h1>' +
        '<p class="login-sub">Checking authentication...</p>' +
      '</div>' +
    '</div>';

  try {
    const redirectResult = await auth.getRedirectResult();

    if (redirectResult.user) {
      console.log("REDIRECT SUCCESS:", redirectResult.user.email);
    } else {
      console.log("NO REDIRECT USER");
    }
  } catch (err) {
    console.error("REDIRECT ERROR:", err);
    renderLogin("Google sign in failed.");
  }

  auth.onAuthStateChanged(async (user) => {
    console.log("AUTH STATE:", user);

    if (!user) {
      currentUser = null;
      renderLogin();
      return;
    }

    const email = (user.email || "").toLowerCase().trim();
    const allowed = ALLOWED_EMAIL.toLowerCase().trim();

    console.log("USER:", email);
    console.log("ALLOWED:", allowed);

    if (email !== allowed) {
      currentUser = null;

      renderAccessDenied(user.email || "Unknown email");

      try {
        await auth.signOut();
      } catch (e) {
        console.error("SIGN OUT ERROR:", e);
      }

      return;
    }

    currentUser = user;

    try {
      await load();
    } catch (e) {
      console.error("LOAD ERROR:", e);
    }

    render();
  });
}

function renderLogin(errorMsg = "") {
  const app = ensureApp();

  app.innerHTML =
    '<div class="login-screen">' +
      '<div class="login-card">' +
        '<div class="login-mark">S</div>' +
        '<h1 class="login-title">Stockroom</h1>' +
        '<p class="login-sub">Sign in to continue</p>' +

        (errorMsg
          ? '<p class="login-error">' + escapeHtml(errorMsg) + '</p>'
          : "") +

        '<button class="login-btn" id="google-login-btn">' +
          'Sign in with Google' +
        '</button>' +
      '</div>' +
    '</div>';

  const btn = document.getElementById("google-login-btn");

  if (btn) {
    btn.onclick = async () => {
      try {
        console.log("STARTING REDIRECT");
        await auth.signInWithRedirect(provider);
      } catch (e) {
        console.error("LOGIN ERROR:", e);
        toast("Google sign in failed");
      }
    };
  }
}

function renderAccessDenied(email) {
  const app = ensureApp();

  app.innerHTML =
    '<div class="login-screen">' +
      '<div class="login-card">' +
        '<div class="login-mark" style="background:#ff5c7a;color:white;">✕</div>' +
        '<h1 class="login-title">Access Denied</h1>' +
        '<p class="login-sub">This Google account is not authorized.</p>' +
        '<p class="login-error">' + escapeHtml(email) + '</p>' +
        '<button class="login-btn" id="retry-login-btn">' +
          'Try Another Account' +
        '</button>' +
      '</div>' +
    '</div>';

  const btn = document.getElementById("retry-login-btn");

  if (btn) {
    btn.onclick = async () => {
      try {
        await auth.signOut();
        await auth.signInWithRedirect(provider);
      } catch (e) {
        console.error(e);
      }
    };
  }
}

// ── Data ──────────────────────────────────────────────────
async function load() {
  try {
    const localProducts = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "[]"
    );

    const localSales = JSON.parse(
      localStorage.getItem(SALES_KEY) || "[]"
    );

    if (Array.isArray(localProducts)) {
      state.products = localProducts;
    }

    if (Array.isArray(localSales)) {
      state.sales = localSales;
    }
  } catch (e) {
    console.error("LOCAL LOAD ERROR:", e);
  }

  try {
    const [productsSnap, salesSnap] = await Promise.all([
      db.collection("products").get(),
      db.collection("sales").get()
    ]);

    if (!productsSnap.empty) {
      state.products = productsSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));
    }

    if (!salesSnap.empty) {
      state.sales = salesSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));
    }

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(state.products)
    );

    localStorage.setItem(
      SALES_KEY,
      JSON.stringify(state.sales)
    );

    console.log("FIREBASE LOAD COMPLETE");
  } catch (e) {
    console.warn("FIREBASE LOAD FAILED:", e);
  }
}

async function save() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(state.products)
  );

  localStorage.setItem(
    SALES_KEY,
    JSON.stringify(state.sales)
  );

  try {
    for (const p of state.products) {
      await db.collection("products").doc(p.id).set(p);
    }

    for (const s of state.sales) {
      await db.collection("sales").doc(s.id).set(s);
    }

    console.log("SAVE COMPLETE");
  } catch (e) {
    console.error("FIREBASE SAVE FAILED:", e);
  }
}

// ── Filters ───────────────────────────────────────────────
function categories() {
  return [
    "All",
    ...new Set(
      state.products
        .map((p) => p.category)
        .filter(Boolean)
    )
  ];
}

function filteredProducts() {
  const q = state.query.toLowerCase().trim();

  return state.products.filter((p) => {
    const matchesQuery =
      !q ||
      [p.name, p.sku, p.category, p.barcode]
        .some((x) =>
          String(x || "")
            .toLowerCase()
            .includes(q)
        );

    const matchesCategory =
      state.category === "All" ||
      p.category === state.category;

    const matchesStatus =
      state.status === "All" ||
      (state.status === "In stock" &&
        p.stock > p.reorder) ||
      (state.status === "Low" &&
        p.stock > 0 &&
        p.stock <= p.reorder) ||
      (state.status === "Out" &&
        p.stock === 0);

    return (
      matchesQuery &&
      matchesCategory &&
      matchesStatus
    );
  });
}

function totals() {
  const retail = state.products.reduce(
    (s, p) => s + p.price * p.stock,
    0
  );

  const cost = state.products.reduce(
    (s, p) => s + p.cost * p.stock,
    0
  );

  const units = state.products.reduce(
    (s, p) => s + p.stock,
    0
  );

  const revenue = state.sales.reduce(
    (s, sale) => s + sale.total,
    0
  );

  return {
    retail,
    cost,
    units,
    revenue,
    margin: retail - cost
  };
}

// ── Render ────────────────────────────────────────────────
function render() {
  const app = ensureApp();

  const t = totals();

  app.innerHTML =
    '<div class="shell">' +

      '<aside class="sidebar">' +
        '<div class="brand">' +
          '<div class="mark">S</div>' +
          '<div>' +
            '<h1>Stockroom</h1>' +
            '<p>Inventory System</p>' +
          '</div>' +
        '</div>' +

        '<nav class="nav">' +
          navBtn("inventory", "Inventory") +
          navBtn("sell", "Checkout") +
          navBtn("reports", "Reports") +
        '</nav>' +

        '<div class="side-card">' +
          '<p class="side-note">' +
            escapeHtml(currentUser?.email || "") +
          '</p>' +

          '<button class="ghost-button" data-action="signout">' +
            'Sign Out' +
          '</button>' +
        '</div>' +
      '</aside>' +

      '<main class="main">' +

        '<div class="topbar">' +
          '<div>' +
            '<h2>Stockroom Dashboard</h2>' +
            '<p>Manage products and sales</p>' +
          '</div>' +

          '<div class="actions">' +
            '<button class="primary-button" data-action="new-product">' +
              'New Product' +
            '</button>' +
          '</div>' +
        '</div>' +

        '<section class="grid stats">' +
          '<div class="stat">' +
            '<small>Inventory Value</small>' +
            '<strong>' + money(t.retail) + '</strong>' +
          '</div>' +

          '<div class="stat">' +
            '<small>Total Units</small>' +
            '<strong>' + number(t.units) + '</strong>' +
          '</div>' +

          '<div class="stat">' +
            '<small>Total Revenue</small>' +
            '<strong>' + money(t.revenue) + '</strong>' +
          '</div>' +

          '<div class="stat">' +
            '<small>Projected Margin</small>' +
            '<strong>' + money(t.margin) + '</strong>' +
          '</div>' +
        '</section>' +

        renderInventory() +

      '</main>' +
    '</div>';

  bindEvents();
}

function navBtn(tab, label) {
  return (
    '<button data-tab="' + tab + '" ' +
    'class="' + (state.tab === tab ? "active" : "") + '">' +
      escapeHtml(label) +
    '</button>'
  );
}

function renderInventory() {
  const products = filteredProducts();

  const rows = products.map((p) => {
    return (
      '<tr>' +

        '<td>' + escapeHtml(p.name) + '</td>' +
        '<td>' + escapeHtml(p.sku) + '</td>' +
        '<td>' + escapeHtml(p.category) + '</td>' +
        '<td>' + number(p.stock) + '</td>' +
        '<td>' + money(p.price) + '</td>' +

        '<td>' +
          '<div class="table-actions">' +

            '<button class="icon-button" ' +
              'data-action="edit" ' +
              'data-id="' + p.id + '">' +
              'Edit' +
            '</button>' +

            '<button class="icon-button" ' +
              'data-action="delete" ' +
              'data-id="' + p.id + '">' +
              'Delete' +
            '</button>' +

          '</div>' +
        '</td>' +

      '</tr>'
    );
  }).join("");

  return (
    '<section class="panel">' +

      '<div class="search-row">' +

        '<input ' +
          'class="input" ' +
          'placeholder="Search products..." ' +
          'data-input="query" ' +
          'value="' + escapeHtml(state.query) + '">' +

        '<select class="select" data-input="category">' +
          categories().map((c) => {
            return (
              '<option ' +
                (state.category === c ? "selected" : "") +
              '>' +
                escapeHtml(c) +
              '</option>'
            );
          }).join("") +
        '</select>' +

      '</div>' +

      '<div class="table-wrap">' +

        '<table>' +

          '<thead>' +
            '<tr>' +
              '<th>Name</th>' +
              '<th>SKU</th>' +
              '<th>Category</th>' +
              '<th>Stock</th>' +
              '<th>Price</th>' +
              '<th></th>' +
            '</tr>' +
          '</thead>' +

          '<tbody>' +
            rows +
          '</tbody>' +

        '</table>' +

      '</div>' +

    '</section>'
  );
}

// ── Events ────────────────────────────────────────────────
function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tab = btn.dataset.tab;
      render();
    });
  });

  document.querySelectorAll("[data-input]").forEach((input) => {
    const eventType =
      input.dataset.input === "query"
        ? "input"
        : "change";

    input.addEventListener(eventType, () => {
      state[input.dataset.input] = input.value;

      if (input.dataset.input === "query") {
        clearTimeout(filterTimer);

        filterTimer = setTimeout(() => {
          render();
        }, 120);
      } else {
        render();
      }
    });
  });

  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      handleAction(
        btn.dataset.action,
        btn.dataset.id
      );
    });
  });
}

function handleAction(action, id) {
  switch (action) {

    case "new-product":
      openProductModal();
      break;

    case "edit":
      openProductModal(id);
      break;

    case "delete":
      deleteProduct(id);
      break;

    case "signout":
      auth.signOut();
      break;
  }
}

// ── Product CRUD ──────────────────────────────────────────
async function deleteProduct(id) {
  const product = state.products.find((p) => p.id === id);

  if (!product) return;

  if (!confirm("Delete " + product.name + "?")) {
    return;
  }

  state.products = state.products.filter(
    (p) => p.id !== id
  );

  try {
    await db.collection("products").doc(id).delete();
  } catch (e) {
    console.error(e);
  }

  await save();

  render();

  toast("Product deleted");
}

function openProductModal(id) {
  const existing = state.products.find(
    (p) => p.id === id
  );

  const product = existing || {
    name: "",
    sku: "",
    category: "",
    barcode: "",
    stock: 0,
    price: 0,
    cost: 0
  };

  const modal = document.createElement("div");

  modal.className = "modal-backdrop";

  modal.innerHTML =
    '<form class="modal" id="product-form">' +

      '<div class="panel-head">' +
        '<div>' +
          '<h3>' +
            (existing ? "Edit Product" : "New Product") +
          '</h3>' +
        '</div>' +
      '</div>' +

      '<div class="modal-body">' +

        field("Name", "name", product.name) +
        field("SKU", "sku", product.sku) +
        field("Category", "category", product.category) +
        field("Barcode", "barcode", product.barcode) +
        field("Stock", "stock", product.stock, "number") +
        field("Cost", "cost", product.cost, "number") +
        field("Price", "price", product.price, "number") +

      '</div>' +

      '<div class="modal-foot">' +
        '<button type="button" class="ghost-button" data-close>' +
          'Cancel' +
        '</button>' +

        '<button type="submit" class="primary-button">' +
          'Save Product' +
        '</button>' +
      '</div>' +

    '</form>';

  document.body.appendChild(modal);

  modal.querySelector("[data-close]").onclick = () => {
    modal.remove();
  };

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  modal.querySelector("#product-form")
    .addEventListener("submit", async (e) => {

      e.preventDefault();

      const data = new FormData(e.target);

      const next = {
        id: existing ? existing.id : uid(),
        name: String(data.get("name") || "").trim(),
        sku: String(data.get("sku") || "").trim(),
        category: String(data.get("category") || "").trim(),
        barcode: String(data.get("barcode") || "").trim(),
        stock: Number(data.get("stock") || 0),
        cost: Number(data.get("cost") || 0),
        price: Number(data.get("price") || 0)
      };

      if (!next.name || !next.sku) {
        toast("Name and SKU required");
        return;
      }

      if (existing) {
        state.products = state.products.map((p) =>
          p.id === existing.id ? next : p
        );
      } else {
        state.products.unshift(next);
      }

      await save();

      modal.remove();

      render();

      toast("Product saved");
    });
}

function field(
  label,
  name,
  value = "",
  type = "text"
) {
  return (
    '<div class="field">' +

      '<label>' +
        escapeHtml(label) +
      '</label>' +

      '<input ' +
        'class="input" ' +
        'name="' + escapeHtml(name) + '" ' +
        'type="' + escapeHtml(type) + '" ' +
        'value="' + escapeHtml(value) + '">' +

    '</div>'
  );
}

// ── Toast ─────────────────────────────────────────────────
function toast(msg) {
  const old = document.querySelector(".toast");

  if (old) {
    old.remove();
  }

  const el = document.createElement("div");

  el.className = "toast";
  el.textContent = msg;

  document.body.appendChild(el);

  setTimeout(() => {
    el.remove();
  }, 2500);
}

// ── Start ─────────────────────────────────────────────────
window.addEventListener(
  "DOMContentLoaded",
  startAuth
);

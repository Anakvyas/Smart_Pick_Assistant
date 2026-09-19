import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { adminApi } from '../api/adminApi';
import BackgroundDecor from '../components/BackgroundDecor';
import './AdminPage.css';

const STATUS_META = {
  ASSIGNED: { label: 'Assigned', variant: 'neutral' },
  IN_PROGRESS: { label: 'In progress', variant: 'warning' },
  COMPLETED: { label: 'Completed', variant: 'success' },
};

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function ProductRow({ product, onAdd }) {
  const handleDragStart = (e) => {
    e.dataTransfer.setData('application/x-product-id', product.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div
      className="product-row"
      draggable
      onDragStart={handleDragStart}
      onDoubleClick={() => onAdd(product)}
      title="Drag into the cart, or double-click / use + to add"
    >
      {product.image ? (
        <img className="product-thumb" src={product.image} alt="" />
      ) : (
        <div className="product-thumb product-thumb-empty" aria-hidden="true">{product.name[0]}</div>
      )}
      <div className="product-row-text">
        <p className="product-row-name">{product.name}</p>
        <p className="product-row-meta">{product.company || 'Unbranded'}{product.mrp ? ` · ${product.mrp}` : ''}</p>
      </div>
      <button type="button" className="add-chip" onClick={() => onAdd(product)} aria-label={`Add ${product.name}`}>
        +
      </button>
    </div>
  );
}

function CartLine({ line, onQuantity, onRemove }) {
  return (
    <div className="cart-line">
      <div className="cart-line-text">
        <p className="cart-line-name">{line.name}</p>
        {!line.product_id && <p className="cart-line-meta">Custom item · matched by label only</p>}
      </div>
      <div className="qty-stepper">
        <button type="button" onClick={() => onQuantity(line.key, line.quantity - 1)} aria-label="Decrease quantity">−</button>
        <span>{line.quantity}</span>
        <button type="button" onClick={() => onQuantity(line.key, line.quantity + 1)} aria-label="Increase quantity">+</button>
      </div>
      <button type="button" className="cart-line-remove" onClick={() => onRemove(line.key)} aria-label={`Remove ${line.name}`}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  );
}

function AdminPage() {
  const { logout } = useAuth();

  const [query, setQuery] = useState('');
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const dropRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const [cart, setCart] = useState([]);
  const [customName, setCustomName] = useState('');
  const [strictOverride, setStrictOverride] = useState('default'); // 'default' | 'on' | 'off'
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [createdOrder, setCreatedOrder] = useState(null);

  const [orders, setOrders] = useState([]);
  const [ordersState, setOrdersState] = useState('loading'); // loading | done | error

  const loadOrders = () => {
    adminApi.orders()
      .then((res) => { setOrders(res.data.orders); setOrdersState('done'); })
      .catch(() => setOrdersState('error'));
  };

  useEffect(() => { loadOrders(); }, []);

  // Debounced search — fires 200ms after typing stops rather than on every
  // keystroke, so a fast typist doesn't fan out a request per letter.
  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      setProductsLoading(true);
      adminApi.products(query)
        .then((res) => { if (active) setProducts(res.data.products); })
        .catch(() => { if (active) setProducts([]); })
        .finally(() => { if (active) setProductsLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(t); };
  }, [query]);

  const addProduct = (product) => {
    setCart((c) => {
      const existing = c.find((l) => l.product_id === product.id);
      if (existing) {
        return c.map((l) => (l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...c, { key: product.id, product_id: product.id, name: product.name, quantity: 1 }];
    });
  };

  const addCustom = () => {
    const name = customName.trim();
    if (!name) return;
    setCart((c) => [...c, { key: `custom-${Date.now()}`, product_id: null, name, quantity: 1 }]);
    setCustomName('');
  };

  const setQuantity = (key, quantity) => {
    setCart((c) => (
      quantity < 1
        ? c.filter((l) => l.key !== key)
        : c.map((l) => (l.key === key ? { ...l, quantity } : l))
    ));
  };

  const removeLine = (key) => setCart((c) => c.filter((l) => l.key !== key));

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const id = e.dataTransfer.getData('application/x-product-id');
    const product = products.find((p) => p.id === id);
    if (product) addProduct(product);
  };

  const totalUnits = useMemo(() => cart.reduce((sum, l) => sum + l.quantity, 0), [cart]);

  const handleCreate = async () => {
    if (cart.length === 0 || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const payload = {
        items: cart.map((l) => ({ product_id: l.product_id, name: l.product_id ? null : l.name, quantity: l.quantity })),
        strict_label_verification: strictOverride === 'default' ? null : strictOverride === 'on',
      };
      const res = await adminApi.createOrder(payload);
      setCreatedOrder(res.data.order);
      setCart([]);
      loadOrders();
      setTimeout(() => setCreatedOrder(null), 4000);
    } catch (err) {
      setCreateError(err?.payload?.error?.message || 'Could not create the order.');
    } finally {
      setCreating(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    window.location.href = '/login';
  };

  return (
    <main className="admin-shell">
      <BackgroundDecor />
      <header className="dashboard-header admin-header">
        <div className="brand-lockup">
          <div className="brand-lockup-mark" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7 12 3l9 4-9 4-9-4Z" />
              <path d="M3 7v10l9 4 9-4V7" />
              <path d="M12 11v10" />
            </svg>
          </div>
          <p className="eyebrow">Smart Picker Admin</p>
        </div>
        <div className="admin-header-actions">
          <Link to="/dashboard" className="admin-nav-link">My orders</Link>
          <button type="button" className="logout-button" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <section className="admin-content">
        <div className="admin-grid">
          <div className="panel builder-panel">
            <div className="panel-header">
              <h2>Build an order</h2>
              <span className="panel-count">{totalUnits} unit{totalUnits === 1 ? '' : 's'}</span>
            </div>

            <div className="search-wrap">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="text"
                placeholder="Search products by name, barcode, or brand..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="product-list">
              {productsLoading && <p className="empty-state">Searching…</p>}
              {!productsLoading && products.length === 0 && (
                <p className="empty-state">No products match {query ? `“${query}”` : 'the catalog'}.</p>
              )}
              {!productsLoading && products.map((p) => (
                <ProductRow key={p.id} product={p} onAdd={addProduct} />
              ))}
            </div>

            <div className="custom-item-row">
              <input
                type="text"
                placeholder="Or add a custom item by name…"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
              />
              <button type="button" className="add-chip" onClick={addCustom} aria-label="Add custom item">+</button>
            </div>

            <div
              ref={dropRef}
              className={`cart-dropzone${dragOver ? ' is-dragover' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <p className="cart-dropzone-label">Cart — drag products here, or use +</p>
              {cart.length === 0 && <p className="empty-state">Nothing added yet.</p>}
              {cart.map((line) => (
                <CartLine key={line.key} line={line} onQuantity={setQuantity} onRemove={removeLine} />
              ))}
            </div>

            <div className="strict-toggle">
              <p className="strict-toggle-label">
                Label verification for this order
                <span
                  className="info-dot"
                  tabIndex={0}
                  title="Strict (default): a scanned barcode must also match the item's name/label before it counts as verified. Off: the barcode alone is trusted. Barcode-only (custom items) verifies on label alone either way, since they have no barcode to check."
                >i</span>
              </p>
              <div className="strict-toggle-options">
                <button type="button" className={strictOverride === 'default' ? 'is-active' : ''} onClick={() => setStrictOverride('default')}>App default</button>
                <button type="button" className={strictOverride === 'on' ? 'is-active' : ''} onClick={() => setStrictOverride('on')}>Strict</button>
                <button type="button" className={strictOverride === 'off' ? 'is-active' : ''} onClick={() => setStrictOverride('off')}>Barcode only</button>
              </div>
            </div>

            {createError && <p className="api-error">{createError}</p>}
            {createdOrder && (
              <p className="create-success">Created {createdOrder.order_number} with {createdOrder.unit_count} unit(s).</p>
            )}

            <button
              type="button"
              className="primary-button admin-create-button"
              disabled={cart.length === 0 || creating}
              onClick={handleCreate}
            >
              {creating ? <span className="button-spinner" /> : null}
              {creating ? 'Creating…' : `Create order${cart.length ? ` (${cart.length} product${cart.length === 1 ? '' : 's'})` : ''}`}
            </button>
          </div>

          <div className="panel orders-panel">
            <div className="panel-header">
              <h2>All orders</h2>
              {ordersState === 'done' && <span className="panel-count">{orders.length} total</span>}
            </div>

            {ordersState === 'loading' && <p className="empty-state">Loading orders…</p>}
            {ordersState === 'error' && <p className="empty-state" style={{ color: 'var(--danger-strong)' }}>Could not load orders.</p>}
            {ordersState === 'done' && orders.length === 0 && <p className="empty-state">No orders yet — build one on the left.</p>}

            <div className="admin-order-table">
              {ordersState === 'done' && orders.map((order) => {
                const meta = STATUS_META[order.status] || { label: order.status, variant: 'neutral' };
                const pct = order.unit_count > 0 ? Math.round((order.picked_count / order.unit_count) * 100) : 0;
                return (
                  <div className="admin-order-row" key={order.id}>
                    <div className="admin-order-row-main">
                      <span className={`status-pill ${meta.variant}`}><span className="dot" />{meta.label}</span>
                      <span className="admin-order-number">{order.order_number}</span>
                    </div>
                    <div className="admin-order-row-meta">
                      <span>{order.product_count} products · {order.unit_count} units</span>
                      <span>{formatTime(order.assigned_at)}</span>
                    </div>
                    <div className="order-progress-track">
                      <div className="order-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default AdminPage;

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ordersApi } from '../api/ordersApi';
import ScanDialog from '../components/ScanDialog';
import OrderWatchDialog from '../components/OrderWatchDialog';
import OrderDetailsDialog from '../components/OrderDetailsDialog';
import BackgroundDecor from '../components/BackgroundDecor';

function getInitials(name) {
  if (!name) return 'P';
  const parts = name.trim().split(/\s+/);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase());
  return initials.join('') || 'P';
}

const STATUS_META = {
  ASSIGNED: { label: 'Assigned', variant: 'neutral' },
  IN_PROGRESS: { label: 'In progress', variant: 'warning' },
  COMPLETED: { label: 'Completed', variant: 'success' },
};

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function OrderCard({ order, onScan, onWatch, onViewDetails }) {
  const meta = STATUS_META[order.status] || { label: order.status, variant: 'neutral' };
  const pct = order.unit_count > 0 ? Math.round((order.picked_count / order.unit_count) * 100) : 0;
  const isCompleted = order.status === 'COMPLETED';

  return (
    <div className="order-card">
      <div className="order-card-head">
        <span className={`status-pill ${meta.variant}`}>
          <span className="dot" />
          {meta.label}
        </span>
      </div>
      <div className="order-body">
        <h3>{order.order_number}</h3>
        <p className="order-meta-line">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
          </svg>
          Assigned: {formatTime(order.assigned_at)}
        </p>
        <p className="order-meta-line">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 7l9-4 9 4-9 4-9-4Z" />
            <path d="M3 7v10l9 4 9-4V7" />
          </svg>
          {order.product_count} products · {order.unit_count} units
        </p>

        <div className="order-progress-row">
          <div className="order-progress-track">
            <div className="order-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="order-progress-label">{order.picked_count} of {order.unit_count} picked</span>
        </div>
      </div>
      <button
        type="button"
        className="secondary-button"
        onClick={() => (isCompleted ? onViewDetails(order) : onScan(order))}
      >
        {isCompleted ? 'View details' : 'Scan to pick'}
      </button>
      {!isCompleted && (
        <button type="button" className="watch-link-button" onClick={() => onWatch(order)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v.01" />
          </svg>
          Scan with another phone instead
        </button>
      )}
    </div>
  );
}

function OrderSkeleton() {
  return (
    <div className="order-skeleton">
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}

function DashboardPage() {
  const { user, logout } = useAuth();
  const [state, setState] = useState({ status: 'loading', orders: [], error: null });
  // Two separate dialogs, not one with a mode toggle: "Scan to pick" opens
  // the camera scanner directly on whatever device is viewing this page
  // (the common case — a picker's own phone) — no QR detour needed when
  // the device in your hand already has the camera. "Scan with another
  // phone" is the deliberate opt-in for handing scanning off to a
  // different device, via the QR + live watch view.
  const [scanningOrder, setScanningOrder] = useState(null);
  const [watchingOrder, setWatchingOrder] = useState(null);
  // A completed order has nothing left to scan — "View details" opens a
  // read-only summary (every item's final state, time to complete) instead
  // of the camera scanner.
  const [viewingDetailsOrder, setViewingDetailsOrder] = useState(null);

  useEffect(() => {
    let active = true;
    ordersApi.mine()
      .then((res) => {
        if (!active) return;
        setState({ status: 'done', orders: res.data.orders, error: null });
      })
      .catch((err) => {
        if (!active) return;
        setState({ status: 'error', orders: [], error: err?.payload?.error?.message || 'Could not load your orders.' });
      });
    return () => { active = false };
  }, []);

  const handleLogout = async () => {
    await logout();
    window.location.href = '/login';
  };

  // Every verify call returns the order exactly as the backend now has it
  // (picked_count, status) — just swap it in rather than guessing locally.
  const handleOrderUpdated = (updatedOrder) => {
    setState((s) => ({
      ...s,
      orders: s.orders.map((o) => (o.id === updatedOrder.id ? updatedOrder : o)),
    }));
  };

  const activeCount = state.orders.filter((o) => o.status !== 'COMPLETED').length;

  return (
    <main className="dashboard-shell">
      <BackgroundDecor />
      <header className="dashboard-header">
        <div className="brand-lockup">
          <div className="brand-lockup-mark" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7 12 3l9 4-9 4-9-4Z" />
              <path d="M3 7v10l9 4 9-4V7" />
              <path d="M12 11v10" />
            </svg>
          </div>
          <p className="eyebrow">Smart Picker</p>
        </div>
        <button type="button" className="logout-button" onClick={handleLogout}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5M21 12H9" />
          </svg>
          Logout
        </button>
      </header>

      <section className="dashboard-content">
        <div className="welcome-row">
          <div className="welcome-avatar" aria-hidden="true">{getInitials(user?.name)}</div>
          <div>
            <h1>Welcome, {user?.name?.split(' ')[0] || 'Picker'}</h1>
            <p className="role-tag">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 12l5 5L20 6" />
              </svg>
              {user?.role || 'PICKER'}
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Assigned Orders</h2>
            {state.status === 'done' && (
              <span className="panel-count">{activeCount} active</span>
            )}
          </div>

          {state.status === 'loading' && (
            <>
              <OrderSkeleton />
              <div style={{ height: 12 }} />
              <OrderSkeleton />
            </>
          )}

          {state.status === 'error' && (
            <p className="empty-state" style={{ color: 'var(--danger-strong)' }}>{state.error}</p>
          )}

          {state.status === 'done' && state.orders.length === 0 && (
            <p className="empty-state">No orders assigned yet — check back soon.</p>
          )}

          {state.status === 'done' && state.orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onScan={setScanningOrder}
              onWatch={setWatchingOrder}
              onViewDetails={setViewingDetailsOrder}
            />
          ))}
        </div>
      </section>

      {viewingDetailsOrder && (
        <OrderDetailsDialog
          order={viewingDetailsOrder}
          onClose={() => setViewingDetailsOrder(null)}
        />
      )}

      {scanningOrder && (
        <ScanDialog
          order={scanningOrder}
          onClose={() => setScanningOrder(null)}
          onOrderUpdated={handleOrderUpdated}
          onShowQR={() => { setWatchingOrder(scanningOrder); setScanningOrder(null); }}
        />
      )}

      {watchingOrder && (
        <OrderWatchDialog
          order={watchingOrder}
          onClose={() => setWatchingOrder(null)}
          onOrderUpdated={handleOrderUpdated}
          onShowScanner={() => { setScanningOrder(watchingOrder); setWatchingOrder(null); }}
        />
      )}
    </main>
  );
}

export default DashboardPage;

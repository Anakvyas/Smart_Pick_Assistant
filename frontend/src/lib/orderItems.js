// Shared by ScanDialog.jsx (the phone scanner) and OrderWatchDialog.jsx
// (the PC watch view) — both need the exact same definition of "is this
// item still up for grabs" so they never disagree about what's left on an
// order. Mirrors the backend's own _TERMINAL_STATUSES in
// controllers/order_controller.py.

const TERMINAL_STATUSES = new Set(['VERIFIED', 'UNAVAILABLE'])

export const isPending = (item) => !TERMINAL_STATUSES.has(item.status)

export const firstPending = (items) => items.find(isPending) || null

export const countResolved = (items) => items.length - items.filter(isPending).length

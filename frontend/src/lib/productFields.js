export const FIELD_KEYS = [
  'name', 'mfg_date', 'expiry', 'weight', 'mrp',
  'company', 'address', 'gstin', 'batch', 'barcode',
]

export const FIELD_LABELS = {
  name: 'name',
  mfg_date: 'mfg. date',
  expiry: 'expiry',
  weight: 'weight',
  mrp: 'MRP',
  gstin: 'GSTIN',
  company: 'company',
  address: 'address',
  batch: 'batch',
  barcode: 'barcode no.',
}

export function fieldRows(r) {
  return FIELD_KEYS.filter((k) => r[k]).map((k) => [k, FIELD_LABELS[k], r[k]])
}

export function fieldsLine(r) {
  const parts = []
  if (r.name) parts.push(r.name)
  if (r.mfg_date) parts.push('mfg ' + r.mfg_date)
  if (r.expiry) parts.push('exp ' + r.expiry)
  if (r.weight) parts.push(r.weight)
  if (r.mrp) parts.push(r.mrp)
  if (r.gstin) parts.push('GSTIN ' + r.gstin)
  if (r.company) parts.push(r.company)
  if (r.batch) parts.push('batch ' + r.batch)
  return parts.length ? parts.join(' · ') : null
}

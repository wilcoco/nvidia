/** Shared by the browser engine and HTTP boundary. Empty optional values are omitted. */
export function validateFields(fields) {
  if (!Array.isArray(fields)) return 'fields must be an array'
  const keys = new Set()
  for (const f of fields) {
    if (!f || typeof f.key !== 'string' || !f.key.trim() || f.key !== f.key.trim() || keys.has(f.key)) return 'Field keys must be non-empty and unique.'
    if ((f.required !== undefined && typeof f.required !== 'boolean') || (f.confirm !== undefined && typeof f.confirm !== 'boolean')) return `Invalid required/confirm setting: ${f.key}`
    keys.add(f.key)
    if (!['number', 'string', 'boolean', 'select'].includes(f.type)) return `Unsupported field type: ${f.key}`
    if (f.confirm && f.type !== 'boolean') return `Only boolean fields may require confirmation: ${f.key}`
    if (f.type === 'select' && (!Array.isArray(f.options) || !f.options.length ||
      f.options.some(o => typeof o !== 'string' || !o.trim() || o !== o.trim()) || new Set(f.options).size !== f.options.length))
      return `Choose non-empty, unique options for ${f.key}.`
  }
  return null
}

export function validateFieldValues(fields, values = {}) {
  const errors = []
  for (const f of fields) {
    const v = values?.[f.key]
    const label = f.label || f.key
    const empty = v == null || (typeof v === 'string' && !v.trim())
    if (f.confirm && v !== true) { errors.push(`${label}: confirmation required`); continue }
    if (empty) { if (f.required) errors.push(`${label}: required`); continue }
    if (f.type === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) errors.push(`${label}: enter a finite number`)
    if (f.type === 'boolean' && typeof v !== 'boolean') errors.push(`${label}: choose true or false`)
    if (f.type === 'string' && typeof v !== 'string') errors.push(`${label}: enter text`)
    if (f.type === 'select' && !f.options?.includes(v)) errors.push(`${label}: choose one of the listed options`)
  }
  return errors
}

/** A single edge evaluates one observation of each key, so its rules must
 * have at least one possible value. Separate task observations are not ANDed. */
export function validateCriteria(criteria = {}, fields = []) {
  for (const [key, rule] of Object.entries(criteria)) {
    const field = fields.find(f => f.key === key)
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) || !Object.keys(rule).length)
      return `Invalid condition for ${key}.`
    const entries = Object.entries(rule)
    if (entries.some(([op, value]) => !['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].includes(op) ||
      !['number', 'string', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))))
      return `Invalid condition for ${key}.`
    const numeric = entries.some(([op]) => ['gt', 'gte', 'lt', 'lte'].includes(op))
    if (numeric && (entries.some(([op, v]) => !['eq', 'ne'].includes(op) && typeof v !== 'number') ||
      (field && field.type !== 'number'))) return `Use numeric bounds only for a number: ${key}.`
    const accepts = v => entries.every(([op, t]) => op === 'eq' ? v === t : op === 'ne' ? v !== t :
      typeof v === 'number' && (op === 'gt' ? v > t : op === 'gte' ? v >= t : op === 'lt' ? v < t : v <= t))
    const domain = field?.confirm ? [true] : field?.type === 'boolean' ? [false, true] : field?.type === 'select' ? field.options : null
    let impossible = domain ? !domain.some(accepts) : false
    if ('eq' in rule) impossible ||= !accepts(rule.eq) ||
      (field?.type === 'number' && typeof rule.eq !== 'number') || (field?.type === 'string' && typeof rule.eq !== 'string')
    if (numeric) {
      const lower = Math.max(rule.gt ?? -Infinity, rule.gte ?? -Infinity)
      const upper = Math.min(rule.lt ?? Infinity, rule.lte ?? Infinity)
      impossible ||= lower > upper || (lower === upper && !accepts(lower))
    }
    if (impossible) return `No value can satisfy all conditions for ${key}. Review the rules together; none were discarded.`
  }
  return null
}

/** Every collected value needs a task card that can actually collect it. */
export function validateFieldBindings(map) {
  const fields = map.fields ?? []
  const invalid = validateFields(fields)
  if (invalid) return invalid
  const keys = new Set(fields.map(f => f.key)), assigned = new Set()
  for (const step of map.steps ?? []) {
    if (step.approvalPurpose !== undefined && (step.type !== 'approval' || !['work', 'plan'].includes(step.approvalPurpose)))
      return 'Set approvalPurpose to work or plan on an approval step.'
    if (step.fields !== undefined && !Array.isArray(step.fields)) return `Invalid fields on ${step.label || step.id}`
    if (step.fields?.length && step.type !== 'task') return `Collect inputs in a task before ${step.label || step.id}.`
    for (const key of step.fields ?? []) {
      if (!keys.has(key)) return `Undefined field ${key} on ${step.label || step.id}`
      assigned.add(key)
    }
    for (const edge of step.next ?? []) {
      for (const [key, rule] of Object.entries(edge.criteria ?? {})) {
        const field = fields.find(f => f.key === key)
        if (field?.type !== 'select') continue
        if (!rule || typeof rule !== 'object' || !Object.keys(rule).length ||
          Object.entries(rule).some(([op, target]) => !['eq', 'ne'].includes(op) || !field.options.includes(target)))
          return `Use eq/ne with a listed choice for ${key} on the route to ${edge.to}.`
      }
      const invalidCriteria = validateCriteria(edge.criteria, fields)
      if (invalidCriteria) return `${step.label || step.id} → ${edge.to}: ${invalidCriteria}`
    }
  }
  const missing = fields.filter(f => !assigned.has(f.key))
  return missing.length ? `Assign these inputs to the task that collects them: ${missing.map(f => f.label || f.key).join(', ')}` : null
}

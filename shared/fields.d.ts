import type { FieldDef, ProcessMap } from '../sdk/types'
export function validateFields(fields: unknown): string | null
export function validateFieldValues(fields: FieldDef[], values?: Record<string, unknown>): string[]
export function validateCriteria(criteria?: Record<string, Record<string, number | string | boolean>>, fields?: FieldDef[]): string | null
export function validateFieldBindings(map: Pick<ProcessMap, 'steps' | 'fields'>): string | null

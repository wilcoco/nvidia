let autoApprove = false

export function isAutoApprove(): boolean {
  return autoApprove
}

export function setAutoApprove(value: boolean): void {
  autoApprove = value
}

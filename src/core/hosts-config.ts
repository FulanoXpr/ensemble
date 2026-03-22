import os from 'node:os'

export function getSelfHostId(): string {
  return os.hostname()
}

export function isSelf(hostId: string): boolean {
  return !hostId || hostId === getSelfHostId()
}

export function getHostById(_hostId: string): { url: string } | undefined {
  return undefined // v1: local only
}

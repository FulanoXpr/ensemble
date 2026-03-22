import path from 'node:path'

let _storageDir: string | undefined

export function initEnsemblePaths(storageDir: string): void {
  _storageDir = storageDir
}

export function getEnsembleRegistryDir(): string {
  if (!_storageDir) {
    // Fallback for testing or when extension context not available
    return path.join(process.env.HOME || '/tmp', '.ensemble')
  }
  return path.join(_storageDir, 'registry')
}

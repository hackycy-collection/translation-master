export type DeviceType = 'wasm' | 'webgpu'

/**
 * Check if WebGPU is available in the current environment.
 */
export async function isWebGPUAvailable(): Promise<boolean> {
  const nav = navigator as Navigator & { gpu?: any }
  if (typeof navigator === 'undefined' || !nav.gpu)
    return false
  try {
    const adapter = await nav.gpu.requestAdapter()
    return adapter !== null
  }
  catch {
    return false
  }
}

/**
 * Resolve the actual device to use based on user preference.
 * 'auto' → prefer WebGPU, fallback to WASM.
 */
export async function resolveDevice(requested: 'auto' | 'wasm' | 'webgpu'): Promise<DeviceType> {
  if (requested !== 'auto')
    return requested

  if (await isWebGPUAvailable())
    return 'webgpu'

  return 'wasm'
}

/**
 * Check if running in a Web Worker context.
 */
export function isWorker(): boolean {
  return typeof globalThis !== 'undefined'
    && typeof (globalThis as any).Window === 'undefined'
    && typeof (globalThis as any).WorkerGlobalScope !== 'undefined'
}

/**
 * Check if running in a browser context.
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

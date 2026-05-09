/* eslint-disable node/prefer-global/process */

/**
 * Check if running in a Node.js environment.
 */
export function isNode(): boolean {
  try {
    return typeof process !== 'undefined'
      && typeof process.versions !== 'undefined'
      && typeof process.versions.node !== 'undefined'
  }
  catch {
    return false
  }
}

/** Serialize read-modify-write operations on shared progress between local Chrome tabs. */
export function withProgressLock<T>(action: () => T): Promise<T> {
  return navigator.locks ? navigator.locks.request('fitpal-local-progress', action) : Promise.resolve(action())
}

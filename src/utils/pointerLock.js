/**
 * Requests pointer lock on an element, preferring unadjusted (raw) mouse movement
 * when supported by the browser to avoid OS acceleration and cursor-warp spikes,
 * and falling back to standard pointer lock if rejected or unsupported.
 * @param {HTMLElement|null|undefined} element
 */
export function requestPointerLockSafe(element) {
  if (!element || typeof element.requestPointerLock !== 'function') return;

  try {
    const result = element.requestPointerLock({ unadjustedMovement: true });
    if (result && typeof result.catch === 'function') {
      result.catch(() => {
        try {
          const fallback = element.requestPointerLock();
          if (fallback && typeof fallback.catch === 'function') {
            fallback.catch(() => {});
          }
        } catch (_) {
          // Non-critical: pointer lock denied or unsupported
        }
      });
    }
  } catch (_) {
    try {
      const fallback = element.requestPointerLock();
      if (fallback && typeof fallback.catch === 'function') {
        fallback.catch(() => {});
      }
    } catch (_) {
      // Non-critical: pointer lock denied or unsupported
    }
  }
}

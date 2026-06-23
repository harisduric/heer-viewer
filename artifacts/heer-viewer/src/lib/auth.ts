type NavigateFn = (to: string) => void;

let _navigate: NavigateFn | null = null;

/** Registered by AuthGuard after mount so the fetch interceptor can navigate. */
export function registerNavigate(fn: NavigateFn): void {
  _navigate = fn;
}

/**
 * Save the current path (if provided) and navigate to /unlock.
 * Called by the global fetch interceptor on unexpected 401 responses.
 */
export function redirectToUnlock(currentPath?: string): void {
  if (currentPath && currentPath !== "/unlock") {
    sessionStorage.setItem("heer_redirect", currentPath);
  }
  _navigate?.("/unlock");
}

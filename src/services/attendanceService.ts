/**
 * Field Sales attendance: login/logout session tracking + GPS capture,
 * driven entirely by the existing Supabase auth lifecycle. See
 * database/migrations/20261113000001_employee_attendance_tracking.sql for
 * the server side - every RPC below silently does nothing for a
 * non-"sales" account, and the frontend never needs to know the caller's
 * role before calling it.
 *
 * Nothing here is reachable from, or displayed to, the Field Sales UI -
 * these are fire-and-forget calls made from the existing sign-in/sign-out
 * code paths. A failure here must never block or disrupt a real login or
 * logout, so every entry point below catches its own errors.
 */

export type LocationStatus = 'captured' | 'permission_denied' | 'unavailable' | 'timeout' | 'unsupported' | 'not_attempted';
export interface CapturedLocation { status: LocationStatus; lat: number | null; lng: number | null; accuracyM: number | null }

const GPS_TIMEOUT_MS = 8000;

/**
 * Resolves within GPS_TIMEOUT_MS no matter what - a denied permission,
 * disabled location services, no GPS fix, or no Geolocation API at all
 * all resolve to a status, never a rejection, and never block the caller.
 */
export function captureLocation(timeoutMs: number = GPS_TIMEOUT_MS): Promise<CapturedLocation> {
  const empty = (status: LocationStatus): CapturedLocation => ({ status, lat: null, lng: null, accuracyM: null });
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(empty('unsupported'));
  }
  return new Promise<CapturedLocation>(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => resolve({
        status: 'captured',
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracyM: position.coords.accuracy
      }),
      error => {
        const status: LocationStatus =
          error.code === error.PERMISSION_DENIED ? 'permission_denied' :
          error.code === error.TIMEOUT ? 'timeout' : 'unavailable';
        resolve(empty(status));
      },
      { timeout: timeoutMs, maximumAge: 0, enableHighAccuracy: false }
    );
  });
}

/**
 * The Supabase (GoTrue) access token's own "session_id" claim: stable
 * across a token refresh, different for each new sign-in. Decoded here
 * purely as an idempotency key for the attendance RPCs below - never
 * trusted for identity or authorization. The database re-derives the
 * real caller itself via auth.uid() on every call; a wrong or missing
 * value here only means a login/logout call is skipped, never that the
 * wrong person's attendance gets recorded.
 */
export function sessionIdFromAccessToken(accessToken: string | undefined | null): string | null {
  try {
    if (!accessToken) return null;
    const payload = accessToken.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.session_id === 'string' && json.session_id ? json.session_id : null;
  } catch {
    return null;
  }
}

/**
 * Call once per real sign-in - i.e. only when onAuthStateChange reports
 * event === 'SIGNED_IN'. Never call this for 'TOKEN_REFRESHED' or
 * 'INITIAL_SESSION': the RPC is idempotent on session_id either way, but
 * gating here too avoids an unnecessary GPS prompt on every token refresh.
 */
export async function recordAttendanceLogin(supabase: any, session: { access_token?: string } | null | undefined): Promise<void> {
  try {
    if (!supabase) return;
    const sessionId = sessionIdFromAccessToken(session?.access_token);
    if (!sessionId) return;
    const location = await captureLocation();
    await supabase.rpc('record_attendance_login', {
      p_session_id: sessionId, p_lat: location.lat, p_lng: location.lng,
      p_accuracy_m: location.accuracyM, p_location_status: location.status
    });
  } catch (error) {
    console.error('[Attendance] Failed to record login (sign-in proceeds regardless):', error);
  }
}

/**
 * Call from the explicit "Sign out" action, BEFORE supabase.auth.signOut()
 * invalidates the session - never from a SIGNED_OUT auth event (which
 * also fires for reasons that are not an explicit logout, e.g. a revoked
 * or expired session). Logout must always complete even if this fails.
 */
export async function recordAttendanceLogout(supabase: any): Promise<void> {
  try {
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const sessionId = sessionIdFromAccessToken(data?.session?.access_token);
    if (!sessionId) return;
    const location = await captureLocation();
    await supabase.rpc('record_attendance_logout', {
      p_session_id: sessionId, p_lat: location.lat, p_lng: location.lng,
      p_accuracy_m: location.accuracyM, p_location_status: location.status
    });
  } catch (error) {
    console.error('[Attendance] Failed to record logout (sign-out proceeds regardless):', error);
  }
}

// Validate sessions with Supabase Auth; never trust a browser-supplied user ID.
export async function requireUser(req, res) {
  const authorization = req.headers?.authorization;
  if (typeof authorization !== 'string' || !/^Bearer\s+\S+$/i.test(authorization)) {
    res.status(401).json({ error: 'Sign in to continue.' });
    return null;
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    res.status(503).json({ error: 'Authentication is not configured.' });
    return null;
  }
  const headers = { apikey: key, Authorization: authorization };
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
      headers, signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      res.status(response.status >= 500 ? 503 : 401).json({ error: 'Unable to verify session.' });
      return null;
    }
    const user = await response.json();
    if (!user?.id || user.is_anonymous) {
      res.status(401).json({ error: 'Sign in to continue.' });
      return null;
    }
    return { user, headers, url: url.replace(/\/$/, '') };
  } catch {
    res.status(503).json({ error: 'Authentication is temporarily unavailable.' });
    return null;
  }
}

// Use the caller's JWT so the database's existing RLS policies remain in force.
export async function requireCompanyAccess(auth, companyId, res) {
  if (typeof companyId !== 'string' || !/^[0-9a-f-]{36}$/i.test(companyId)) {
    res.status(400).json({ error: 'A valid company_id is required.' });
    return false;
  }
  try {
    const response = await fetch(`${auth.url}/rest/v1/profiles?id=eq.${encodeURIComponent(companyId)}&select=id`, {
      headers: auth.headers, signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      res.status(response.status >= 500 ? 503 : 403).json({ error: 'Unable to verify company access.' });
      return false;
    }
    const profiles = await response.json();
    if (!Array.isArray(profiles) || !profiles.some(p => p.id === companyId)) {
      res.status(403).json({ error: 'Company access denied.' });
      return false;
    }
    return true;
  } catch {
    res.status(503).json({ error: 'Unable to verify company access.' });
    return false;
  }
}

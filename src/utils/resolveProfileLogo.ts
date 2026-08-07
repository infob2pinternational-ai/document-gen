import type { CompanyProfile } from '../types';

/**
 * Resolves a company profile's logo to a URL valid for whichever build is
 * running - the desktop web app (vite.config.ts, base: '/billing/') or
 * the B2P ONE mobile/Capacitor app (vite.mobile.config.ts, base: './').
 * Both configs copy the same public/logo_b2p_*.png files into their own
 * output root (dist/billing/ and dist/mobile/ respectively), so a path
 * resolved against import.meta.env.BASE_URL always points at a file that
 * actually exists in whichever build is currently running.
 *
 * profiles.logo_url is a database column, and for the two B2P house-brand
 * profiles it stores a legacy absolute path (`/billing/logo_b2p_*.png?v=5`)
 * written back when the desktop app used to hardcode that value locally
 * (see App.tsx's old loadData() mapping). That path is only valid under
 * desktop's own /billing/-prefixed hosting - on mobile, where there is no
 * /billing/ prefix at all, it 404s (broken image icon) even though the
 * PNG itself ships correctly at the mobile bundle's root.
 *
 * Re-deriving the same house-brand file and resolving it against
 * BASE_URL keeps desktop's output byte-for-byte identical to the stored
 * value (BASE_URL there already is '/billing/') while fixing mobile. Any
 * profile with a real uploaded logo (base64 data URI or Supabase Storage
 * URL) passes through completely untouched - only the known legacy
 * `/billing/logo_b2p_*` path, or a missing logo_url on a profile whose
 * name is clearly one of the two house brands, is ever rewritten.
 *
 * Shared by every screen that renders a profile's logo (ProfileSwitcher,
 * DocumentPreview, ...) so they all resolve to the exact same asset
 * instead of each re-implementing (and potentially diverging from) this
 * mapping.
 */
const LEGACY_BILLING_LOGO = /^\/billing\/(logo_b2p_(?:international|intermedia)\.png)(\?.*)?$/;

export function resolveProfileLogo(
  profile: Partial<Pick<CompanyProfile, 'name' | 'logo_url'>> | null | undefined
): string | undefined {
  if (!profile) return undefined;

  const legacyMatch = profile.logo_url?.match(LEGACY_BILLING_LOGO);
  if (legacyMatch) {
    return `${import.meta.env.BASE_URL}${legacyMatch[1]}${legacyMatch[2] || ''}`;
  }
  if (profile.logo_url) return profile.logo_url;

  // No logo_url stored at all - derive the house-brand file from the
  // profile name, same fallback DocumentPreview.tsx already used for
  // public share links (isPublicShare / no-active-profile paths).
  const lowerName = (profile.name || '').toLowerCase();
  if (lowerName.includes('inter media') || lowerName.includes('inter-media')) {
    return `${import.meta.env.BASE_URL}logo_b2p_intermedia.png?v=5`;
  }
  if (lowerName.includes('international') || lowerName.includes('b2p')) {
    return `${import.meta.env.BASE_URL}logo_b2p_international.png?v=5`;
  }
  return undefined;
}

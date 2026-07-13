import { readFileSync } from 'fs';
import { join } from 'path';

// Escape untrusted strings before they are interpolated into HTML
// (company/customer names, document numbers, etc. can contain
// characters supplied by end users, so this prevents HTML/script
// injection into the page served for social-preview crawlers and
// for anyone who opens a shared document link).
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Validate the shape of the ID before using it in a query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  // Security headers for every response this function returns.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  const { id } = req.query;

  let title = "B2P International - Document Portal";
  let description = "View and download your digital invoices, quotations, and work orders.";
  let logoUrl = "https://b2pinternational.com/billing/logo_b2p_international.png?v=5";

  // Credentials now come from environment variables (set in the Vercel
  // project settings) instead of being hardcoded in source. Never commit
  // real values to .env files that get checked into git.
  const supabaseUrl = process.env.SUPABASE_URL;
  const apiKey = process.env.SUPABASE_ANON_KEY;

  if (supabaseUrl && apiKey && id && UUID_RE.test(String(id))) {
    try {
      // Fetch document to get company_id
      const docRes = await fetch(`${supabaseUrl}/rest/v1/documents?id=eq.${encodeURIComponent(id)}&select=company_id,document_number,document_type,customer_name`, {
        headers: {
          "apikey": apiKey,
          "Authorization": `Bearer ${apiKey}`
        }
      });

      if (docRes.ok) {
        const docs = await docRes.json();
        if (docs && docs.length > 0) {
          const doc = docs[0];
          const companyId = doc.company_id;

          // Fetch company profile to get logo
          const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(companyId)}&select=name`, {
            headers: {
              "apikey": apiKey,
              "Authorization": `Bearer ${apiKey}`
            }
          });

          if (profileRes.ok) {
            const profiles = await profileRes.json();
            if (profiles && profiles.length > 0) {
              const profile = profiles[0];
              const isIntermedia = profile.name.toLowerCase().includes('inter') || profile.name.toLowerCase().includes('media');

              title = isIntermedia
                ? "B2P Inter-Media Solutions - Document Portal"
                : "B2P International - Document Portal";

              description = `View and download document #${doc.document_number} for ${doc.customer_name}.`;

              logoUrl = isIntermedia
                ? "https://b2pinternational.com/billing/logo_b2p_intermedia.png?v=5"
                : "https://b2pinternational.com/billing/logo_b2p_international.png?v=5";
            }
          }
        }
      }
    } catch (err) {
      // Log full detail server-side only; never forward this to the client.
      console.error("Error fetching OG meta:", err);
    }
  }

  // Escape all values before interpolating into HTML.
  title = escapeHtml(title);
  description = escapeHtml(description);
  logoUrl = escapeHtml(logoUrl);

  try {
    // Read build output file
    const htmlPath = join(process.cwd(), 'dist', 'billing', 'index.html');
    let html = readFileSync(htmlPath, 'utf8');

    // Replace OG metadata tags
    html = html.replace(/<title>[^<]*<\/title>/g, `<title>${title}</title>`);
    html = html.replace(/<meta property="og:title" content="[^"]*" \/>/g, `<meta property="og:title" content="${title}" />`);
    html = html.replace(/<meta property="og:description" content="[^"]*" \/>/g, `<meta property="og:description" content="${description}" />`);
    html = html.replace(/<meta property="og:image" content="[^"]*" \/>/g, `<meta property="og:image" content="${logoUrl}" />`);
    html = html.replace(/<meta name="description" content="[^"]*" \/>/g, `<meta name="description" content="${description}" />`);

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  } catch (err) {
    // Never leak internal error details (file paths, stack traces) to the client.
    console.error("Error serving document page:", err);
    res.status(500).send("Something went wrong. Please try again later.");
  }
};

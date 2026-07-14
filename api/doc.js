import { readFileSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';
import https from 'https';

// Helper to sign JWT using RS256 with Node's native crypto module
function signJwt(payload, privateKey) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const toSign = `${base64Header}.${base64Payload}`;
  
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(toSign);
  let formattedKey = privateKey.trim();
  if (formattedKey.startsWith('"') && formattedKey.endsWith('"')) {
    formattedKey = formattedKey.slice(1, -1);
  }
  if (formattedKey.startsWith("'") && formattedKey.endsWith("'")) {
    formattedKey = formattedKey.slice(1, -1);
  }
  formattedKey = formattedKey.replace(/\r/g, '').replace(/\\n/g, '\n');
  if (!formattedKey.endsWith('\n')) {
    formattedKey += '\n';
  }
  const signature = sign.sign(formattedKey, 'base64url');
  
  return `${toSign}.${signature}`;
}

// Helper to make HTTPS requests using Node's native module
function httpsRequest(url, options, bodyContent) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: () => {
            try {
              return JSON.parse(data);
            } catch (e) {
              return { error: 'Failed to parse JSON response', raw: data };
            }
          },
          text: () => data
        });
      });
    });

    req.on('error', (err) => reject(err));

    if (bodyContent) {
      req.write(bodyContent);
    }
    req.end();
  });
}

// Fetch Google OAuth 2.0 Access Token for FCM scope
async function getAccessToken(clientEmail, privateKey) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  
  const jwtPayload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp
  };
  
  const assertion = signJwt(jwtPayload, privateKey);
  
  const response = await httpsRequest('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  }, `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`);
  
  if (!response.ok) {
    const errText = response.text();
    throw new Error(`Failed to obtain Google access token: ${response.status} - ${errText}`);
  }
  
  const data = response.json();
  return data.access_token;
}

// Escape untrusted strings before they are interpolated into HTML
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
  // CORS & Security headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Debug-Action', String(req.query?.action || 'undefined'));
  res.setHeader('X-Debug-Url', String(req.url || 'undefined'));

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Handle FCM send-push action
  if (req.query.action === 'send-push') {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { token, title, body, data } = req.body || {};

    if (!token || !title || !body) {
      return res.status(400).json({ error: 'Missing required parameters: token, title, and body' });
    }

    // Get credentials from environment variables (configured securely on Vercel)
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
      return res.status(500).json({
        error: 'Firebase service account configuration is missing on the server environment variables.'
      });
    }

    const cryptoHash = crypto.createHash('sha256').update(privateKey.trim()).digest('hex');
    res.setHeader('X-Key-Hash', cryptoHash);
    res.setHeader('X-Key-Length', String(privateKey.length));
    res.setHeader('X-Key-Start', privateKey.substring(0, 30).replace(/\n/g, '\\n'));
    res.setHeader('X-Key-End', privateKey.substring(privateKey.length - 30).replace(/\n/g, '\\n'));
    res.setHeader('X-Key-Escaped-Newlines', String((privateKey.match(/\\n/g) || []).length));
    res.setHeader('X-Key-Real-Newlines', String((privateKey.match(/\n/g) || []).length));

    let attempt = 0;
    const maxRetry = 3;
    let delay = 1000;

    while (attempt < maxRetry) {
      try {
        attempt++;
        console.log(`[Push API] Sending notification attempt ${attempt}...`);
        
        const accessToken = await getAccessToken(clientEmail, privateKey);
        
        // Call Firebase HTTP v1 API
        const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
        const fcmPayload = {
          message: {
            token,
            notification: { title, body },
            data: data || {}
          }
        };

        const fcmResponse = await httpsRequest(fcmUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }, JSON.stringify(fcmPayload));

        const fcmResult = fcmResponse.json();

        if (fcmResponse.ok) {
          console.log('[Push API] FCM message sent successfully:', fcmResult);
          return res.status(200).json({ success: true, messageId: fcmResult.name });
        }

        // Handle invalid/expired token responses
        const errorMsg = fcmResult?.error?.message || 'Unknown FCM error';
        const errorCode = fcmResult?.error?.status || 'UNKNOWN';

        if (errorCode === 'UNREGISTERED' || errorCode === 'INVALID_ARGUMENT') {
          console.log(`[Push API] Token is invalid (${errorCode}): ${token}`);
          return res.status(410).json({ error: 'unregistered', message: 'Token is no longer valid' });
        }

        // If it's a transient server error, retry. Otherwise fail.
        if (fcmResponse.status >= 500) {
          throw new Error(`Transient FCM error: ${fcmResponse.status} - ${errorMsg}`);
        } else {
          throw new Error(`Permanent FCM error: ${fcmResponse.status} - ${errorMsg}`);
        }

      } catch (err) {
        console.error(`[Push API] Attempt ${attempt} failed:`, err.message);
        
        const isTransient = err.message.includes('Transient') || err.message.includes('fetch') || err.message.includes('ECONNRESET');
        if (isTransient && attempt < maxRetry) {
          console.log(`[Push API] Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // exponential backoff
        } else {
          return res.status(502).json({ error: 'gateway_error', message: err.message });
        }
      }
    }
    return;
  }

  // Otherwise, handle regular HTML dynamic preview logic (doc share links)
  const { id } = req.query;

  let title = "B2P International - Document Portal";
  let description = "View and download your digital invoices, quotations, and work orders.";
  let logoUrl = "https://b2pinternational.com/billing/logo_b2p_international.png?v=5";

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
    console.error("Error serving document page:", err);
    res.status(500).send("Something went wrong. Please try again later.");
  }
}

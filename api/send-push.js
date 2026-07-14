import crypto from 'crypto';
import https from 'https';

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

// Helper to sign JWT using RS256 with Node's native crypto module
function signJwt(payload, privateKey) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const toSign = `${base64Header}.${base64Payload}`;
  
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(toSign);
  const formattedKey = privateKey.replace(/\\n/g, '\n');
  const signature = sign.sign(formattedKey, 'base64url');
  
  return `${toSign}.${signature}`;
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

export default async function handler(req, res) {
  // CORS & Security headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { token, title, body, data } = req.body;

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
}

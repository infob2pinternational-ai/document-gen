import { requireUser, requireCompanyAccess } from '../server/auth.js';
import https from 'https';
import crypto from 'crypto';


// Read the original bytes through Vercel's restored request stream. Do not
// reconstruct JSON from req.body: whitespace changes invalidate Meta's HMAC.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 1024 * 1024) {
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('Request aborted')));
  });
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
            } catch {
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

const DEFAULT_SUPABASE_URL = 'https://rqovkmjsdwzggebvwvdk.supabase.co';
const DEFAULT_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxb3ZrbWpzZHd6Z2dlYnZ3dmRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNDQ0MzMsImV4cCI6MjA5ODcyMDQzM30.A_4pG8rG4KDTxa85DSjJ1Y6wGwqMwXPL9DrlzoYjZ9M';

// Helper to query Supabase REST API securely from serverless function
async function supabaseRest(endpoint, method = 'GET', body = null) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/${endpoint}`;
  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  try {
    const res = await httpsRequest(url, { method, headers }, body ? JSON.stringify(body) : null);
    if (res.ok) {
      return res.json();
    }
    console.error(`[WhatsApp API] Supabase REST error ${res.status}:`, res.text());
    return null;
  } catch (err) {
    console.error('[WhatsApp API] Supabase REST exception:', err);
    return null;
  }
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  // 1. GET: Webhook verification challenge from Meta
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (verifyToken && mode === 'subscribe' && token === verifyToken) {
      console.log('[WhatsApp Webhook] Verification successful');
      return res.status(200).send(challenge);
    } else {
      console.warn('[WhatsApp Webhook] Verification failed, token mismatch');
      return res.status(403).json({ error: 'Verification failed' });
    }
  }

  let auth;
  if (req.method === 'POST') {
    if (req.query.action === 'send-message') {
      auth = await requireUser(req, res);
      if (!auth) return;
    } else if (req.query.action) {
      return res.status(400).json({ error: 'Unknown action.' });
    } else if (!process.env.WHATSAPP_APP_SECRET) {
      return res.status(503).json({ error: 'Webhook verification is not configured.' });
    }

    let rawBody;
    try {
      rawBody = await readBody(req);
    } catch {
      return res.status(400).json({ error: 'Unable to read request body.' });
    }
    if (!auth) {
      const signature = req.headers?.['x-hub-signature-256'];
      const expected = crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(rawBody).digest();
      if (typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/i.test(signature) ||
          !crypto.timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) {
        return res.status(401).json({ error: 'Invalid webhook signature.' });
      }
    }
    try {
      req.body = JSON.parse(rawBody.toString('utf8'));
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new Error('Invalid body');
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body.' });
    }
  }

  // 2. POST with ?action=send-message (Outbound dispatch from B2P ERP)
  if (req.method === 'POST' && req.query.action === 'send-message') {
    const {
      phone,
      type = 'text',
      text,
      template_name,
      template_language = 'en',
      template_components = [],
      media_url,
      media_filename,
      company_id
    } = req.body || {};

    let targetCompanyId = company_id;
    if (!targetCompanyId) {
      try {
        const profileRes = await fetch(`${auth.url}/rest/v1/profiles?limit=1&select=id`, {
          headers: auth.headers, signal: AbortSignal.timeout(10000)
        });
        if (profileRes.ok) {
          const profs = await profileRes.json();
          if (Array.isArray(profs) && profs.length > 0) {
            targetCompanyId = profs[0].id;
          }
        }
      } catch (err) {
        console.warn('Could not auto-resolve default company_id:', err);
      }
    }

    if (!await requireCompanyAccess(auth, targetCompanyId, res)) return;

    if (!phone) {
      return res.status(400).json({ error: 'Missing target phone number' });
    }

    let cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

    if (cleanPhone === '918139009034') {
      return res.status(400).json({
        success: false,
        error: "Cannot send WhatsApp messages to the business's own phone number (+91 81390 09034). Please send to a customer's phone number."
      });
    }

    const bizyleadApiKey = process.env.BIZYLEAD_API_KEY || 'c6a02de1ededcd12342b6302ec4b052f76eb83f273994a4606fa070333a0a1ce';
    let bizyleadPhoneId = process.env.BIZYLEAD_PHONE_NUMBER_ID || '992427143955673';
    // Auto-correct old typo (9824 -> 9924)
    if (bizyleadPhoneId === '982427143955673') {
      bizyleadPhoneId = '992427143955673';
    }
    const bizyleadBaseUrl = process.env.BIZYLEAD_BASE_URL || 'https://app.bizylead.com/api/v2/whatsapp-business';

    // 1. Primary Outbound Provider: Bizylead Official WhatsApp Business API
    if (bizyleadApiKey && bizyleadPhoneId) {
      const messageContent = text || (media_url ? `${text ? text + '\n' : ''}${media_url}` : '');
      const bizyPayload = {
        to: cleanPhone,
        phoneNoId: bizyleadPhoneId,
        type: 'text',
        text: messageContent
      };

      try {
        const bizyUrl = `${bizyleadBaseUrl.replace(/\/$/, '')}/messages`;
        const response = await httpsRequest(bizyUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${bizyleadApiKey}`,
            'Content-Type': 'application/json'
          }
        }, JSON.stringify(bizyPayload));

        const resData = response.json();

        if (!response.ok) {
          console.error('[WhatsApp API] Bizylead API returned error:', resData);
          return res.status(response.status || 500).json({
            success: false,
            error: resData?.error?.message || resData?.message || resData?.error || 'Bizylead API error',
            details: resData
          });
        }

        const waMsgId = resData?.messageId || resData?.messages?.[0]?.id || resData?.id || resData?.data?.id || `bizy_${Date.now()}`;
        return res.status(200).json({
          success: true,
          messageId: waMsgId,
          provider: 'bizylead'
        });
      } catch (err) {
        console.error('[WhatsApp API] Exception sending via Bizylead:', err);
        return res.status(500).json({ error: 'Internal server error with Bizylead', details: String(err) });
      }
    }

    // 2. Secondary Fallback: Meta Cloud API directly
    if (!phoneNumberId || !accessToken) {
      return res.status(503).json({ success: false, error: 'WhatsApp API credentials are not configured.' });
    }

    // Build Meta Graph API message payload
    let metaPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone
    };

    if (type === 'template' && template_name) {
      metaPayload.type = 'template';
      metaPayload.template = {
        name: template_name,
        language: { code: template_language },
        components: template_components
      };
    } else if (type === 'document' && media_url) {
      metaPayload.type = 'document';
      metaPayload.document = {
        link: media_url,
        caption: text || '',
        filename: media_filename || 'Document.pdf'
      };
    } else {
      metaPayload.type = 'text';
      metaPayload.text = {
        preview_url: true,
        body: text || ''
      };
    }

    try {
      const metaUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
      const response = await httpsRequest(metaUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }, JSON.stringify(metaPayload));

      const resData = response.json();

      if (!response.ok) {
        console.error('[WhatsApp API] Meta Graph API returned error:', resData);
        return res.status(response.status).json({
          success: false,
          error: resData?.error?.message || 'Meta API error',
          details: resData
        });
      }

      const waMsgId = resData?.messages?.[0]?.id;
      if (!waMsgId) return res.status(502).json({ success: false, error: 'Meta did not confirm message acceptance.' });

      // The authenticated client persists the message once, with its local ID.
      return res.status(200).json({
        success: true,
        messageId: waMsgId,
        provider: 'meta'
      });
    } catch (err) {
      console.error('[WhatsApp API] Error sending WhatsApp message:', err);
      return res.status(500).json({ error: 'Internal server error', details: String(err) });
    }
  }

  // 3. POST: Inbound Webhook Event from Meta
  if (req.method === 'POST') {
    const payload = req.body;

    // Log raw webhook event
    await supabaseRest('whatsapp_webhooks_log', 'POST', {
      event_type: 'meta_webhook',
      payload: payload || {},
      processed: true
    }).catch(() => {});

    if (!payload || payload.object !== 'whatsapp_business_account') {
      return res.status(200).send('EVENT_RECEIVED');
    }

    try {
      const entries = payload.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const value = change.value;
          if (!value) continue;

          // A. Status updates (sent, delivered, read, failed)
          if (value.statuses && Array.isArray(value.statuses)) {
            for (const statusObj of value.statuses) {
              const waId = statusObj.id;
              const status = statusObj.status; // 'delivered', 'read', 'failed'
              const errMsg = statusObj.errors?.[0]?.message || null;

              if (waId) {
                await supabaseRest(`whatsapp_messages?wa_message_id=eq.${waId}`, 'PATCH', {
                  status: status,
                  error_message: errMsg
                });
              }
            }
          }

          // B. Inbound Customer Messages
          if (value.messages && Array.isArray(value.messages)) {
            const contactName = value.contacts?.[0]?.profile?.name || 'WhatsApp Contact';

            for (const msg of value.messages) {
              const fromPhone = msg.from; // e.g. "919876543210"
              const waMsgId = msg.id;
              const msgType = msg.type; // 'text', 'image', 'document', 'interactive'
              let textContent = '';

              if (msgType === 'text') {
                textContent = msg.text?.body || '';
              } else if (msgType === 'interactive') {
                textContent = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '[Interactive Reply]';
              } else if (msgType === 'image') {
                textContent = msg.image?.caption || '[Image received]';
              } else if (msgType === 'document') {
                textContent = msg.document?.caption || `[Document: ${msg.document?.filename || 'File'}]`;
              } else {
                textContent = `[${msgType} message]`;
              }

              // Find or create conversation for this phone number
              let convs = await supabaseRest(`whatsapp_conversations?phone=eq.${fromPhone}&select=id,customer_name,unread_count`);
              let convId = convs?.[0]?.id;

              if (!convId) {
                // Auto-create conversation
                const newConv = await supabaseRest('whatsapp_conversations', 'POST', {
                  customer_name: contactName,
                  phone: fromPhone,
                  last_message: textContent,
                  last_message_at: new Date().toISOString(),
                  unread_count: 1,
                  status: 'open'
                });
                convId = newConv?.[0]?.id;

                // Auto-create lead in CRM leads table for new contacts
                try {
                  await supabaseRest('leads', 'POST', {
                    customer_name: contactName,
                    phone: fromPhone,
                    whatsapp_number: fromPhone,
                    lead_source: 'whatsapp',
                    source_details: 'Inbound WhatsApp Inquiry',
                    status: 'NEW',
                    priority: 'WARM',
                    notes: `Initiated chat: "${textContent.substring(0, 200)}"`
                  });
                } catch (e) {
                  console.error('[WhatsApp Inbound] Failed to auto-create lead:', e);
                }
              } else {
                // Update existing conversation
                const currentUnread = (convs[0]?.unread_count || 0) + 1;
                await supabaseRest(`whatsapp_conversations?id=eq.${convId}`, 'PATCH', {
                  last_message: textContent,
                  last_message_at: new Date().toISOString(),
                  unread_count: currentUnread,
                  updated_at: new Date().toISOString()
                });
              }

              // Insert incoming message
              if (convId) {
                await supabaseRest('whatsapp_messages', 'POST', {
                  conversation_id: convId,
                  wa_message_id: waMsgId,
                  sender_type: 'customer',
                  sender_name: contactName,
                  message_type: msgType === 'text' ? 'text' : (msgType === 'image' ? 'image' : 'document'),
                  text: textContent,
                  status: 'delivered'
                });
              }
            }
          }
        }
      }

      return res.status(200).send('EVENT_PROCESSED');
    } catch (err) {
      console.error('[WhatsApp Webhook] Inbound processing exception:', err);
      return res.status(200).send('ERROR_HANDLED');
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}

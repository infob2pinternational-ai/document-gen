import https from 'https';

// Read raw request body stream
function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object') {
      return resolve(req.body);
    }
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
    req.on('end', () => {
      try {
        const str = Buffer.concat(chunks).toString('utf8');
        resolve(str ? JSON.parse(str) : {});
      } catch {
        resolve({});
      }
    });
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

// Helper to query Supabase REST API securely from serverless function
async function supabaseRest(endpoint, method = 'GET', body = null) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn(`[Bizylead Webhook] supabaseRest SKIPPED: url=${!!supabaseUrl}, key=${!!supabaseKey}, SERVICE_ROLE_KEY=${!!process.env.SUPABASE_SERVICE_ROLE_KEY} (len=${(process.env.SUPABASE_SERVICE_ROLE_KEY||'').length}), ANON_KEY=${!!process.env.SUPABASE_ANON_KEY}`);
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
    console.warn(`[Bizylead Webhook] Supabase REST ${method} ${endpoint} returned ${res.status}:`, res.text());
    return null;
  } catch (err) {
    console.error('[Bizylead Webhook] Supabase REST exception:', err);
    return null;
  }
}

export default async function handler(req, res) {
  // 1. CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2. GET verification ping
  // When Bizylead tests or pings the endpoint upon registration, return 200 OK immediately
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      service: 'B2P Bizylead WhatsApp Webhook Receiver',
      timestamp: new Date().toISOString()
    });
  }

  // 3. POST: Inbound Webhook Event from Bizylead
  if (req.method === 'POST') {
    let payload;
    try {
      payload = await readBody(req);
    } catch (err) {
      console.error('[Bizylead Webhook] Failed to read body:', err);
      return res.status(400).json({ error: 'Unable to parse request body' });
    }

    console.log('[Bizylead Webhook] Received payload:', JSON.stringify(payload));

    // Log raw webhook event to database if table exists
    await supabaseRest('whatsapp_webhooks_log', 'POST', {
      event_type: 'bizylead_webhook',
      payload: payload || {},
      processed: true
    }).catch(() => {});

    if (!payload || typeof payload !== 'object') {
      return res.status(200).json({ status: 'ignored', reason: 'empty_payload' });
    }

    const incomingMessages = [];
    const statusUpdates = [];

    // Parse Format A: Meta WABA structure (if Bizylead passes raw event)
    if (payload.entry && Array.isArray(payload.entry)) {
      for (const entry of payload.entry) {
        for (const change of (entry.changes || [])) {
          const val = change.value;
          if (!val) continue;

          if (Array.isArray(val.messages)) {
            for (const m of val.messages) {
              incomingMessages.push({
                from: m.from,
                text: m.text?.body || m.caption || (m.type ? `[${m.type}]` : '[Message]'),
                id: m.id,
                name: val.contacts?.[0]?.profile?.name || 'WhatsApp Customer',
                timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString()
              });
            }
          }

          if (Array.isArray(val.statuses)) {
            for (const s of val.statuses) {
              statusUpdates.push({
                id: s.id,
                status: s.status, // delivered, read, failed, sent
                error: s.errors?.[0]?.message || null
              });
            }
          }
        }
      }
    }

    // Parse Format B: Bizylead structured messages array
    if (payload.messages && Array.isArray(payload.messages)) {
      for (const m of payload.messages) {
        incomingMessages.push({
          from: m.from || m.phone || m.sender || m.wa_id,
          text: m.text?.body || m.text || m.message || m.body || '',
          id: m.id || m.messageId || m.message_id || `bizy_${Date.now()}`,
          name: m.name || m.contact_name || m.senderName || 'WhatsApp Customer',
          timestamp: m.timestamp || new Date().toISOString()
        });
      }
    } else if (payload.data?.messages && Array.isArray(payload.data.messages)) {
      for (const m of payload.data.messages) {
        incomingMessages.push({
          from: m.from || m.phone || m.sender,
          text: m.text?.body || m.text || m.message || '',
          id: m.id || m.message_id || `bizy_${Date.now()}`,
          name: m.name || m.contact_name || 'WhatsApp Customer',
          timestamp: m.timestamp || new Date().toISOString()
        });
      }
    }

    // Parse Format C: Single message payload
    const singleData = payload.data || payload;
    if (singleData.message && typeof singleData.message === 'string' && (singleData.phone || singleData.from)) {
      incomingMessages.push({
        from: singleData.phone || singleData.from,
        text: singleData.message,
        id: singleData.id || singleData.messageId || singleData.message_id || `bizy_${Date.now()}`,
        name: singleData.name || singleData.contact_name || 'WhatsApp Customer',
        timestamp: singleData.timestamp || new Date().toISOString()
      });
    }

    // Parse Format D: Status update events
    if (payload.statuses && Array.isArray(payload.statuses)) {
      for (const s of payload.statuses) {
        statusUpdates.push({
          id: s.id || s.messageId || s.message_id,
          status: s.status,
          error: s.error || null
        });
      }
    } else if (payload.status && (payload.messageId || payload.message_id || payload.id)) {
      statusUpdates.push({
        id: payload.messageId || payload.message_id || payload.id,
        status: payload.status,
        error: payload.error || null
      });
    }

    // 4. Process Status Updates
    for (const statusObj of statusUpdates) {
      if (statusObj.id) {
        await supabaseRest(`whatsapp_messages?wa_message_id=eq.${statusObj.id}`, 'PATCH', {
          status: statusObj.status,
          error_message: statusObj.error
        }).catch(() => {});
      }
    }

    // Fetch default company_id from profiles so RLS scopes allow portal users to view records
    let defaultCompanyId = null;
    try {
      const profiles = await supabaseRest('profiles?limit=1&select=id');
      if (profiles && profiles.length > 0) {
        defaultCompanyId = profiles[0].id;
      }
    } catch (e) {
      console.warn('[Bizylead Webhook] Could not fetch default company_id:', e);
    }

    // 5. Process Inbound Messages
    for (const msg of incomingMessages) {
      if (!msg.from) continue;

      let cleanDigits = String(msg.from).replace(/\D/g, '');
      const phone10 = cleanDigits.length === 12 && cleanDigits.startsWith('91') ? cleanDigits.slice(2) : cleanDigits;
      const phone91 = cleanDigits.length === 10 ? '91' + cleanDigits : cleanDigits;

      const customerName = msg.name || 'WhatsApp Contact';
      const textContent = msg.text || '';
      const waMsgId = msg.id || `bizy_${Date.now()}`;

      // A. Sync to whatsapp_conversations table
      let convId = null;
      try {
        const existingConvs = await supabaseRest(`whatsapp_conversations?phone=eq.${phone91}&select=id,unread_count,company_id`);
        if (existingConvs && existingConvs.length > 0) {
          convId = existingConvs[0].id;
          const currentUnread = (existingConvs[0].unread_count || 0) + 1;
          const patchBody = {
            last_message: textContent,
            last_message_at: new Date().toISOString(),
            unread_count: currentUnread,
            updated_at: new Date().toISOString()
          };
          if (!existingConvs[0].company_id && defaultCompanyId) {
            patchBody.company_id = defaultCompanyId;
          }
          await supabaseRest(`whatsapp_conversations?id=eq.${convId}`, 'PATCH', patchBody);
        } else {
          const newConv = await supabaseRest('whatsapp_conversations', 'POST', {
            company_id: defaultCompanyId,
            customer_name: customerName,
            phone: phone91,
            last_message: textContent,
            last_message_at: new Date().toISOString(),
            unread_count: 1,
            status: 'open'
          });
          convId = newConv?.[0]?.id;
        }
      } catch (err) {
        console.warn('[Bizylead Webhook] Error updating whatsapp_conversations:', err);
      }

      // B. Sync message to whatsapp_messages table
      if (convId) {
        await supabaseRest('whatsapp_messages', 'POST', {
          conversation_id: convId,
          company_id: defaultCompanyId,
          wa_message_id: waMsgId,
          sender_type: 'customer',
          sender_name: customerName,
          message_type: 'text',
          text: textContent,
          status: 'delivered',
          created_at: new Date().toISOString()
        }).catch(() => {});
      }
    }

    return res.status(200).json({
      success: true,
      processedMessages: incomingMessages.length,
      processedStatuses: statusUpdates.length
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

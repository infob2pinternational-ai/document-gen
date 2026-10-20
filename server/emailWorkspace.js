import crypto from 'node:crypto';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { requireCompanyAccess } from './auth.js';
import { requireEmailAccess } from './emailAccess.js';
import { EmailError, uuidPattern, emailPattern, encryptCredentials, decryptCredentials, accountSettings, resolveMailHost } from './emailSecurity.js';

const publicFields = 'id,company_id,name,email,imap_host,imap_port,imap_user,smtp_host,smtp_port,smtp_user,created_at';
export function publicAccount(account) {
  return Object.fromEntries(publicFields.split(',').map(field => [field, account[field]]));
}

export function createEmailRepository(companyId, userId, env = process.env, fetcher = fetch) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const secret = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new EmailError(503, 'Email workspace storage is not configured.');
  async function request(table, query, method = 'GET', body, extraHeaders = {}) {
    const response = await fetcher(`${url.replace(/\/$/,'')}/rest/v1/${table}?company_id=eq.${companyId}&${query}`, {
      method, headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...extraHeaders },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new EmailError(503, 'Email workspace storage is unavailable. Check the setup and retry.');
    return response.status === 204 ? [] : response.json();
  }
  const idQuery = id => {
    if (!uuidPattern.test(id || '')) throw new EmailError(400, 'A valid account ID is required.');
    return `id=eq.${id}`;
  };
  return {
    list: () => request('crm_email_accounts', `select=${publicFields}&order=created_at.asc`),
    async get(id) {
      const rows = await request('crm_email_accounts', `${idQuery(id)}&select=*`);
      if (!rows[0]) throw new EmailError(404, 'Email account not found for this company.');
      return rows[0];
    },
    async save(account, update) {
      const rows = await request('crm_email_accounts', update ? idQuery(account.id) : '', update ? 'PATCH' : 'POST', { ...account, company_id: companyId, created_by: userId });
      if (!rows[0]) throw new EmailError(404, 'Email account was not saved.');
      return publicAccount(rows[0]);
    },
    async remove(id) { await request('crm_email_accounts', idQuery(id), 'DELETE'); },
    async claim(id, accountId) {
      const rows = await request('crm_email_sends', 'on_conflict=id', 'POST', { id, account_id: accountId, company_id: companyId, created_by: userId, status: 'sending' }, { Prefer: 'resolution=ignore-duplicates,return=representation' });
      if (rows.length === 1) return true;
      return false;
    },
    async finish(id, status) { await request('crm_email_sends', `${idQuery(id)}&created_by=eq.${userId}`, 'PATCH', { status, updated_at: new Date().toISOString() }); }
  };
}

export function createEmailHandler(dependencies = {}) {
  const env = dependencies.env || process.env;
  const repository = dependencies.repository || createEmailRepository;
  const authorize = dependencies.authorize || requireEmailAccess;
  const companyAccess = dependencies.companyAccess || requireCompanyAccess;
  const resolveHost = dependencies.resolveHost || (host => resolveMailHost(host, env));
  const makeImap = dependencies.makeImap || (options => new ImapFlow(options));
  const makeSmtp = dependencies.makeSmtp || (options => nodemailer.createTransport(options));
  const parse = dependencies.parse || simpleParser;

  async function withInbox(account, operation) {
    const secret = decryptCredentials(account.credentials_encrypted, account.company_id, account.id, env);
    const endpoint = await resolveHost(account.imap_host);
    const client = makeImap({ host: endpoint.host, servername: endpoint.servername, port: 993, secure: true, auth: { user: account.imap_user, pass: secret.imapPassword }, logger: false, disableAutoIdle: true, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, maxLiteralSize: 3 * 1024 * 1024 });
    client.on?.('error', () => {});
    let lock;
    try {
      await client.connect();
      lock = await client.getMailboxLock('INBOX', { readOnly: true });
      return await operation(client);
    } finally {
      lock?.release();
      // No persistent sockets or mailbox flags are retained by the serverless API.
      client.close();
    }
  }

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const auth = await authorize(req, res);
      if (!auth) return;
      const companyId = req.query?.company_id;
      if (!await companyAccess(auth, companyId, res)) return;
      if (!uuidPattern.test(companyId)) throw new EmailError(400, 'A valid company is required.');
      const action = req.query?.action || 'accounts';
      const method = req.method || 'GET';
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const repo = repository(companyId, auth.user.id, env);
      if (action === 'accounts' && method === 'GET') return res.status(200).json({ accounts: (await repo.list()).map(publicAccount) });
      if (action === 'accounts' && ['POST','PATCH'].includes(method)) {
        const config = accountSettings(body, env);
        const existing = method === 'PATCH' ? await repo.get(body.id) : null;
        if (existing && (
          ((existing.imap_host !== config.imap_host || existing.imap_user !== config.imap_user) && !body.imap_password) ||
          ((existing.smtp_host !== config.smtp_host || existing.smtp_user !== config.smtp_user) && !body.smtp_password)
        )) throw new EmailError(400, 'Re-enter the password when changing a mail server or username.');
        const id = existing?.id || crypto.randomUUID();
        const previous = existing ? decryptCredentials(existing.credentials_encrypted, companyId, id, env) : {};
        const credentials = { imapPassword: body.imap_password || previous.imapPassword, smtpPassword: body.smtp_password || previous.smtpPassword };
        if (Object.values(credentials).some(value => typeof value !== 'string' || !value || value.length > 2000)) throw new EmailError(400, 'Both IMAP and SMTP passwords are required for a new account.');
        const account = await repo.save({ ...config, id, credentials_encrypted: encryptCredentials(credentials, companyId, id, env) }, Boolean(existing));
        return res.status(200).json({ account: publicAccount(account) });
      }
      if (action === 'accounts' && method === 'DELETE') {
        await repo.get(req.query.account_id);
        await repo.remove(req.query.account_id);
        return res.status(200).json({ success: true });
      }
      if (!['inbox','message','send'].includes(action) || (action === 'send' ? method !== 'POST' : method !== 'GET')) {
        throw new EmailError(405, 'Unsupported email action or method.');
      }
      const account = await repo.get(req.query.account_id);
      if (action === 'inbox') {
        const offset = Number(req.query.offset || 0);
        if (!Number.isSafeInteger(offset) || offset < 0) throw new EmailError(400, 'Invalid inbox page.');
        const result = await withInbox(account, async client => {
          const count = client.mailbox.exists;
          const last = count - offset;
          const messages = [];
          if (last > 0) {
            for await (const message of client.fetch(`${Math.max(1,last-24)}:${last}`, { uid: true, envelope: true, flags: true })) {
              const envelope = message.envelope || {};
              messages.push({ uid: message.uid, subject: envelope.subject || '(No subject)', from: envelope.from?.[0]?.address || '', name: envelope.from?.[0]?.name || '', date: envelope.date ? new Date(envelope.date).toISOString() : '', unread: !message.flags?.has('\\Seen') });
            }
          }
          return { messages: messages.reverse(), total: count, uidValidity: String(client.mailbox.uidValidity) };
        });
        return res.status(200).json(result);
      }
      if (action === 'message') {
        const uid = Number(req.query.uid);
        if (!Number.isSafeInteger(uid) || uid < 1) throw new EmailError(400, 'Invalid message ID.');
        const message = await withInbox(account, async client => {
          if (String(client.mailbox.uidValidity) !== req.query.uid_validity) throw new EmailError(409, 'The mailbox changed. Refresh the inbox and reopen the message.');
          const metadata = await client.fetchOne(uid, { size: true }, { uid: true });
          if (!metadata) throw new EmailError(404, 'This message is no longer in the inbox.');
          if (metadata.size > 2 * 1024 * 1024) throw new EmailError(413, 'This message is larger than 2 MB. Open it in your webmail.');
          const raw = await client.fetchOne(uid, { source: true }, { uid: true });
          if (!raw?.source) throw new EmailError(404, 'Message content is unavailable.');
          const parsed = await parse(raw.source, { skipHtmlToText: false, skipTextToHtml: true });
          return { uid, subject: parsed.subject || '(No subject)', from: parsed.from?.text || '', replyTo: parsed.replyTo?.value?.[0]?.address || parsed.from?.value?.[0]?.address || '', text: String(parsed.text || '(No plain-text content available.)').slice(0,200000), date: parsed.date?.toISOString() || '' };
        });
        return res.status(200).json({ message });
      }
      // Individual messages only; no campaign loops or bulk-recipient API.
      const to = String(body.to || '').trim();
      const subject = String(body.subject || '').trim();
      const text = String(body.text || '');
      if (!uuidPattern.test(body.request_id || '') || !emailPattern.test(to) || /[\r\n]/.test(subject) || subject.length > 998 || !text.trim() || text.length > 100000) throw new EmailError(400, 'Enter one valid recipient, a subject without line breaks, and a message.');
      const secret = decryptCredentials(account.credentials_encrypted, companyId, account.id, env);
      const endpoint = await resolveHost(account.smtp_host);
      if (!await repo.claim(body.request_id, account.id)) throw new EmailError(409, 'This send request was already submitted. Check the recipient or your webmail before creating a new message.');
      let attempted = false;
      let transport;
      try {
        transport = makeSmtp({ host: endpoint.host, port: account.smtp_port, secure: account.smtp_port === 465, requireTLS: true, tls: { servername: endpoint.servername, rejectUnauthorized: true }, auth: { user: account.smtp_user, pass: secret.smtpPassword }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000, disableFileAccess: true, disableUrlAccess: true });
        await transport.verify();
        attempted = true;
        const info = await transport.sendMail({ from: { name: account.name, address: account.email }, to, subject, text });
        if (!info.accepted?.length) throw new Error('Recipient was not accepted.');
        await repo.finish(body.request_id, 'accepted');
        return res.status(200).json({ status: 'accepted', message: 'Message accepted by the outgoing mail server.' });
      } catch {
        const status = attempted ? 'uncertain' : 'failed';
        try { await repo.finish(body.request_id, status); } catch { /* The original claim still prevents a duplicate. */ }
        return res.status(attempted ? 202 : 502).json({ status, error: attempted ? 'The sending result could not be confirmed. Do not resend until you check your webmail or the recipient.' : 'Could not connect to the outgoing mail server. Check the account settings before starting a new message.' });
      } finally { transport?.close(); }
    } catch (error) {
      return res.status(error instanceof EmailError ? error.status : 502).json({ error: error instanceof EmailError ? error.message : 'Unable to complete the email action. Check your mail settings and retry.' });
    }
  };
}

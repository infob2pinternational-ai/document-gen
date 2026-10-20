import crypto from 'node:crypto';
import { BlockList, isIPv4 } from 'node:net';
import { lookup } from 'node:dns/promises';

export class EmailError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const emailPattern = /^[^\s<>(),;:@]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

function key(env) {
  if (!/^[a-f0-9]{64}$/i.test(env.EMAIL_ENCRYPTION_KEY || '')) throw new EmailError(503, 'Email credential encryption is not configured.');
  return Buffer.from(env.EMAIL_ENCRYPTION_KEY, 'hex');
}
export function encryptCredentials(value, companyId, accountId, env = process.env) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(env), iv);
  cipher.setAAD(Buffer.from(`${companyId}:${accountId}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(buffer => buffer.toString('base64')).join(':');
}
export function decryptCredentials(value, companyId, accountId, env = process.env) {
  const parts = String(value).split(':').map(part => Buffer.from(part, 'base64'));
  if (parts.length !== 3) throw new EmailError(503, 'Stored email credentials could not be read.');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(env), parts[0]);
    decipher.setAAD(Buffer.from(`${companyId}:${accountId}`));
    decipher.setAuthTag(parts[1]);
    return JSON.parse(Buffer.concat([decipher.update(parts[2]), decipher.final()]).toString());
  } catch { throw new EmailError(503, 'Stored email credentials could not be read.'); }
}

export function allowedHost(value, env = process.env) {
  const host = String(value || '').toLowerCase().trim();
  const allowed = (env.EMAIL_ALLOWED_HOSTS || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) throw new EmailError(503, 'Approved mail server hosts have not been configured.');
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || !allowed.includes(host)) {
    throw new EmailError(400, 'This mail server hostname has not been approved.');
  }
  return host;
}
const privateAddresses = new BlockList();
for (const [network, mask] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) privateAddresses.addSubnet(network, mask);
export async function resolveMailHost(host, env = process.env, resolver = lookup) {
  const servername = allowedHost(host, env);
  const addresses = await resolver(servername, { family: 4, all: true });
  if (!addresses.length || addresses.some(item => !isIPv4(item.address) || privateAddresses.check(item.address))) throw new EmailError(400, 'Mail servers must resolve to public addresses.');
  // Connect to the validated address; keep the original hostname for TLS verification.
  return { host: addresses[0].address, servername };
}
export function accountSettings(body, env = process.env) {
  const string = (field, max = 200) => String(body[field] || '').trim().slice(0, max);
  const config = {
    name: string('name', 100), email: string('email').toLowerCase(),
    imap_host: allowedHost(body.imap_host, env), imap_port: Number(body.imap_port || 993), imap_user: string('imap_user'),
    smtp_host: allowedHost(body.smtp_host, env), smtp_port: Number(body.smtp_port || 465), smtp_user: string('smtp_user')
  };
  if (!config.name || !emailPattern.test(config.email) || !config.imap_user || !config.smtp_user || config.imap_port !== 993 || ![465,587].includes(config.smtp_port)) {
    throw new EmailError(400, 'Enter an account name, valid email, usernames, IMAP port 993 and SMTP port 465 or 587.');
  }
  if ([config.imap_user, config.smtp_user].some(value => /[\r\n\0]/.test(value))) throw new EmailError(400, 'Invalid mail username.');
  return config;
}

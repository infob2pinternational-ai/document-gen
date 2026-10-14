// Local regression guard: block external connections before DNS/socket creation.
const net = require('node:net');
const dns = require('node:dns');
const local = host => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(host || 'localhost'));
const blocked = () => { throw new Error('External network is disabled for local regression tests'); };
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = first && typeof first === 'object' ? first : { host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  if (!options.path && !local(options.host || options.hostname)) blocked();
  return originalConnect.apply(this, args);
};
const lookup = dns.lookup;
dns.lookup = function (host, ...args) {
  if (!local(host)) blocked();
  return lookup.call(this, host, ...args);
};
const promiseLookup = dns.promises.lookup;
dns.promises.lookup = async function (host, ...args) {
  if (!local(host)) blocked();
  return promiseLookup.call(this, host, ...args);
};
for (const name of Object.keys(process.env)) {
  if (/^(SUPABASE_|VITE_SUPABASE_|WHATSAPP_|BIZYLEAD_|META_|SENTRY_|OPENAI_API_KEY$)/.test(name)) delete process.env[name];
}

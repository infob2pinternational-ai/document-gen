import { useEffect, useRef, useState } from 'react';
import type { CompanyProfile } from '../../types';
import { emailRequest } from '../../services/emailWorkspaceService';
import type { EmailAccount, InboxMessage, OpenEmail } from '../../services/emailWorkspaceService';
import { emailProviders, inferEmailProvider } from '../../utils/emailProviders';

const blankAccount = { name: '', email: '', imap_host: '', imap_port: '993', imap_user: '', imap_password: '', smtp_host: '', smtp_port: '465', smtp_user: '', smtp_password: '' };
const buttonStyle = { padding: '0.5rem 0.75rem' };

export default function EmailWorkspace({ activeProfile }: { activeProfile: CompanyProfile | null }) {
  const companyId = activeProfile?.id || '';
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [accountId, setAccountId] = useState('');
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsRevision, setAccountsRevision] = useState(0);
  const [error, setError] = useState('');
  const [accountForm, setAccountForm] = useState<typeof blankAccount | null>(null);
  const [editingId, setEditingId] = useState('');
  const [providerId, setProviderId] = useState('gmail');
  const [saving, setSaving] = useState(false);
  const accountBusy = useRef(false);
  const mailboxGuard = useRef<() => boolean>(() => true);

  useEffect(() => {
    if (!companyId) { setAccountsLoading(false); return; }
    const controller = new AbortController();
    setAccountsLoading(true); setError('');
    emailRequest<{ accounts: EmailAccount[] }>(companyId, 'accounts', {}, undefined, 'GET', controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        setAccounts(data.accounts);
        setAccountId(current => data.accounts.some(account => account.id === current) ? current : (data.accounts[0]?.id || ''));
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setAccountsLoading(false); });
    return () => controller.abort();
  }, [companyId, accountsRevision]);

  const selected = accounts.find(account => account.id === accountId);
  const provider = emailProviders.find(item => item.id === providerId) || emailProviders[4];
  const edit = (account?: EmailAccount) => {
    setProviderId(account ? inferEmailProvider(account.imap_host, account.smtp_host) : 'gmail');
    setEditingId(account?.id || ''); setError('');
    setAccountForm(account ? { ...blankAccount, name: account.name, email: account.email, imap_host: account.imap_host, imap_port: String(account.imap_port), imap_user: account.imap_user, smtp_host: account.smtp_host, smtp_port: String(account.smtp_port), smtp_user: account.smtp_user } : { ...blankAccount, imap_host: 'imap.gmail.com', smtp_host: 'smtp.gmail.com' });
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accountForm || accountBusy.current) return;
    accountBusy.current = true; setSaving(true); setError('');
    try {
      const result = await emailRequest<{ account: EmailAccount }>(companyId, 'accounts', {}, { ...accountForm, ...(editingId ? { id: editingId } : {}) }, editingId ? 'PATCH' : 'POST');
      setAccountId(result.account.id); setAccountForm(null); setAccountsRevision(value => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save account.'); }
    finally { accountBusy.current = false; setSaving(false); }
  };
  const remove = async () => {
    if (!selected || accountBusy.current || !window.confirm(`Remove ${selected.email} from the CRM? Your mailbox and messages stay with your email provider.`)) return;
    accountBusy.current = true; setSaving(true); setError('');
    try { await emailRequest(companyId, 'accounts', { account_id: selected.id }, undefined, 'DELETE'); setAccountsRevision(value => value + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to remove account.'); }
    finally { accountBusy.current = false; setSaving(false); }
  };

  if (!companyId) return <p>Select a company to open Email.</p>;
  return <section style={{ padding: '1rem', maxWidth: 1400, margin: '0 auto' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
      <div><h2 style={{ marginBottom: '0.25rem' }}>Email</h2><p style={{ margin: 0 }}>{activeProfile?.name} · All your accounts in one window</p></div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn-secondary" onClick={() => { if (mailboxGuard.current()) setAccountsRevision(value => value + 1); }} disabled={accountsLoading}>Refresh accounts</button>
        <button type="button" className="btn-primary" onClick={() => edit()}>Add email account</button>
      </div>
    </header>
    {error && <div role="alert" style={{ padding: '0.75rem', marginBottom: '1rem', background: '#fff3cd', color: '#713f12', borderRadius: 8 }}>{error}</div>}
    {accountForm && <form onSubmit={save} style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 10, marginBottom: '1rem' }}>
      <h3>{editingId ? 'Edit email account' : 'Add email account'}</h3>
      <p>Use your provider’s IMAP/SMTP settings and an app password where required. Google/Microsoft one-click sign-in is not included in this version.</p>
      <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0 }}>
        <label style={{ display: 'grid', gap: '0.3rem', marginBottom: '0.75rem' }}>Email provider
          <select className="input-field" value={providerId} onChange={event => {
            const next = emailProviders.find(item => item.id === event.target.value)!;
            setProviderId(next.id);
            setAccountForm({ ...accountForm, imap_host: next.imap, smtp_host: next.smtp, imap_port: '993', smtp_port: '465', imap_user: accountForm.email, smtp_user: accountForm.email, imap_password: '', smtp_password: '' });
          }}>
            {emailProviders.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <p>{provider.help} {provider.url && <a href={provider.url} target="_blank" rel="noopener noreferrer">Provider setup guide</a>}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.8rem' }}>
          {(Object.keys(blankAccount) as (keyof typeof blankAccount)[]).map(field => <label key={field} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {{ name: 'Account name', email: 'Email address', imap_host: 'Incoming IMAP server', imap_port: 'IMAP TLS port', imap_user: 'IMAP username', imap_password: 'IMAP password / app password', smtp_host: 'Outgoing SMTP server', smtp_port: 'SMTP port (465 or 587)', smtp_user: 'SMTP username', smtp_password: 'SMTP password / app password' }[field]}
            <input className="input-field" type={field.includes('password') ? 'password' : field === 'email' ? 'email' : field.includes('port') ? 'number' : 'text'} value={accountForm[field]} required={!editingId || !field.includes('password')} autoComplete={field.includes('password') ? 'new-password' : 'off'} placeholder={editingId && field.includes('password') ? 'Leave blank only if server and username are unchanged' : ''} onChange={event => {
              const value = event.target.value;
              setAccountForm({ ...accountForm, [field]: value, ...(field === 'email' ? { imap_user: value, smtp_user: value } : {}) });
            }} />
          </label>)}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button className="btn-primary" type="submit">{saving ? 'Saving...' : 'Save account'}</button>
          <button className="btn-secondary" type="button" onClick={() => setAccountForm(null)}>Cancel</button>
        </div>
      </fieldset>
    </form>}
    {accountsLoading ? <p role="status">Loading email accounts...</p> : <>
      <nav aria-label="Email accounts" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        {accounts.map(account => <button type="button" key={account.id} className={account.id === accountId ? 'btn-primary' : 'btn-secondary'} aria-pressed={account.id === accountId} onClick={() => { if (account.id !== accountId && mailboxGuard.current()) setAccountId(account.id); }}>{account.name} · {account.email}</button>)}
      </nav>
      {selected ? <>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '1rem' }}>
          <strong>{selected.email}</strong>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn-secondary" onClick={() => edit(selected)} disabled={saving}>Account settings</button>
            <button type="button" className="btn-secondary" onClick={() => void remove()} disabled={saving}>Remove account</button>
          </div>
        </div>
        <Mailbox key={`${companyId}:${selected.id}:${accountsRevision}`} companyId={companyId} account={selected} leaveGuard={mailboxGuard} />
      </> : !error && <p>No email accounts connected. Add an account to get started.</p>}
    </>}
  </section>;
}

function Mailbox({ companyId, account, leaveGuard }: { companyId: string; account: EmailAccount; leaveGuard: { current: () => boolean } }) {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [validity, setValidity] = useState('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [opened, setOpened] = useState<OpenEmail | null>(null);
  const [opening, setOpening] = useState(false);
  const [composing, setComposing] = useState<{ request_id: string; to: string; subject: string; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [sendResult, setSendResult] = useState('');
  const sendBusy = useRef(false);

  useEffect(() => {
    const canLeave = () => {
      if (sendBusy.current) { window.alert('Wait for the current send result before switching accounts.'); return false; }
      return !composing?.text || submitted || window.confirm('Discard this draft and switch the email view?');
    };
    leaveGuard.current = canLeave;
    return () => { if (leaveGuard.current === canLeave) leaveGuard.current = () => true; };
  }, [composing, submitted, leaveGuard]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setOpened(null); setSelectedUid(null);
    emailRequest<{ messages: InboxMessage[]; total: number; uidValidity: string }>(companyId, 'inbox', { account_id: account.id, offset: String(offset) }, undefined, 'GET', controller.signal)
      .then(data => { if (!controller.signal.aborted) { setMessages(data.messages); setTotal(data.total); setValidity(data.uidValidity); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [companyId, account.id, offset, refresh]);

  useEffect(() => {
    if (selectedUid === null) return;
    const controller = new AbortController();
    setOpening(true); setOpened(null); setError('');
    emailRequest<{ message: OpenEmail }>(companyId, 'message', { account_id: account.id, uid: String(selectedUid), uid_validity: validity }, undefined, 'GET', controller.signal)
      .then(data => { if (!controller.signal.aborted) setOpened(data.message); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setOpening(false); });
    return () => controller.abort();
  }, [companyId, account.id, selectedUid, validity]);

  const compose = (reply?: OpenEmail) => {
    if (sending || (composing?.text && !submitted && !window.confirm('Discard the current email draft?'))) return;
    setComposing({ request_id: crypto.randomUUID(), to: reply?.replyTo || '', subject: reply ? (/^re:/i.test(reply.subject) ? reply.subject : `Re: ${reply.subject}`) : '', text: '' });
    setSubmitted(false); setSendResult('');
  };
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!composing || submitted || sendBusy.current) return;
    sendBusy.current = true; setSending(true); setSubmitted(true); setSendResult('Submitting message...');
    try {
      const result = await emailRequest<{ message: string }>(companyId, 'send', { account_id: account.id }, composing);
      setSendResult(result.message);
    } catch (reason) {
      // Keep this request ID and lock the draft. A lost response can mean SMTP
      // accepted it; a second click must not create a fresh send request.
      setSendResult(`${reason instanceof Error ? reason.message : 'Result not confirmed.'} Check before starting another message.`);
    } finally { sendBusy.current = false; setSending(false); }
  };
  return <>
    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
      <button type="button" className="btn-primary" onClick={() => compose()}>New message</button>
      <button type="button" className="btn-secondary" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh inbox</button>
      <span>Inbox · {total} messages</span>
    </div>
    {error && <p role="alert">{error} <button type="button" className="btn-secondary" onClick={() => setRefresh(value => value + 1)}>Retry inbox</button></p>}
    {composing && <form onSubmit={send} style={{ padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 10, marginBottom: '1rem' }}>
      <h3>Compose email</h3><p>From: {account.email}</p>
      <fieldset disabled={sending || submitted} style={{ display: 'grid', gap: '0.75rem', border: 0, padding: 0 }}>
        <label style={{ display: 'grid' }}>To<input className="input-field" type="email" required value={composing.to} onChange={event => setComposing({ ...composing, to: event.target.value })} /></label>
        <label style={{ display: 'grid' }}>Subject<input className="input-field" maxLength={998} value={composing.subject} onChange={event => setComposing({ ...composing, subject: event.target.value })} /></label>
        <label style={{ display: 'grid' }}>Message<textarea className="input-field" rows={9} required maxLength={100000} value={composing.text} onChange={event => setComposing({ ...composing, text: event.target.value })} /></label>
        <button type="submit" className="btn-primary" style={{ justifySelf: 'start' }}>{sending ? 'Sending...' : 'Send email'}</button>
      </fieldset>
      {sendResult && <p role="status">{sendResult}</p>}
      <button type="button" className="btn-secondary" disabled={sending} onClick={() => { if (!composing.text || submitted || window.confirm('Discard this draft?')) setComposing(null); }} style={{ marginTop: '0.75rem' }}>Close compose</button>
    </form>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: '1rem' }}>
      <section aria-label="Inbox messages" style={{ border: '1px solid var(--border-color)', borderRadius: 10, overflow: 'hidden' }}>
        {loading ? <p role="status" style={{ padding: '1rem' }}>Loading inbox...</p> : messages.length === 0 && !error ? <p style={{ padding: '1rem' }}>No messages on this inbox page.</p> : messages.map(message => <button key={message.uid} type="button" disabled={loading} aria-pressed={selectedUid === message.uid} onClick={() => setSelectedUid(message.uid)} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch', textAlign: 'left', padding: '1rem', gap: '0.3rem', borderRadius: 0, borderBottom: '1px solid var(--border-color)', background: selectedUid === message.uid ? '#eff6ff' : 'var(--bg-primary)', color: 'var(--text-primary)' }}>
          <strong>{message.name || message.from}</strong><span>{message.subject}</span><small>{message.date ? new Date(message.date).toLocaleString('en-IN') : ''}{message.unread ? ' · Unread' : ''}</small>
        </button>)}
        <div style={{ display: 'flex', gap: '0.5rem', padding: '0.75rem' }}>
          <button type="button" className="btn-secondary" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0,value-25))} style={buttonStyle}>Newer</button>
          <button type="button" className="btn-secondary" disabled={loading || offset+25 >= total} onClick={() => setOffset(value => value+25)} style={buttonStyle}>Older</button>
        </div>
      </section>
      <section aria-label="Message content" style={{ border: '1px solid var(--border-color)', padding: '1rem', borderRadius: 10, minWidth: 0 }}>
        {opening ? <p role="status">Opening email...</p> : opened ? <>
          <h3 style={{ overflowWrap: 'anywhere' }}>{opened.subject}</h3><p>From: {opened.from}</p><p>{opened.date ? new Date(opened.date).toLocaleString('en-IN') : ''}</p>
          <button className="btn-secondary" type="button" onClick={() => compose(opened)}>Reply</button>
          <pre style={{ fontFamily: 'inherit', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6 }}>{opened.text}</pre>
        </> : <p>Select a message to read it here.</p>}
      </section>
    </div>
    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Inbox and plain-text messages only in this version. Attachments, OAuth sign-in, mailbox folders, and automatic Sent-folder copies are not included.</p>
  </>;
}

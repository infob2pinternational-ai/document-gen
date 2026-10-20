export const emailProviders = [
  { id: 'gmail', label: 'Gmail', imap: 'imap.gmail.com', smtp: 'smtp.gmail.com', help: 'Use your full email address and a Google app password where your account permits it. App passwords require 2-Step Verification. Google sign-in is not included yet.', url: 'https://support.google.com/accounts/answer/185833?hl=en' },
  { id: 'zoho-personal', label: 'Zoho — Personal / eligible free account', imap: 'imap.zoho.com', smtp: 'smtp.zoho.com', help: 'Enable IMAP in Zoho Mail. Use an app-specific password if two-factor authentication is enabled. Confirm the exact regional servers in your Zoho Server Configuration Details; some plans do not include IMAP.', url: 'https://www.zoho.com/mail/help/imap-access.html' },
  { id: 'zoho-organization', label: 'Zoho — Paid organization', imap: 'imappro.zoho.com', smtp: 'smtppro.zoho.com', help: 'These are the .com defaults. Replace them with the exact servers shown in your Zoho account for your data center. Enable IMAP and use an app-specific password if required.', url: 'https://www.zoho.com/mail/help/imap-access.html' },
  { id: 'cpanel', label: 'cPanel / company webmail', imap: '', smtp: '', help: 'In cPanel, open Email Accounts → Connect Devices. Copy the recommended SSL/TLS incoming and outgoing server names. Use the mailbox password, not the cPanel administrator password.', url: 'https://docs.cpanel.net/cpanel/email/set-up-mail-client/' },
  { id: 'custom', label: 'Other / manual settings', imap: '', smtp: '', help: 'Enter the IMAP and SMTP settings provided by your mail service. Only TLS IMAP 993 and SMTP 465/587 are supported.', url: '' }
] as const;

export function inferEmailProvider(imap: string, smtp: string): string {
  return emailProviders.find(provider => provider.imap && provider.imap === imap && provider.smtp === smtp)?.id || 'custom';
}

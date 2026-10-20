import { authenticatedHeaders } from './apiAuth';
export interface EmailAccount {
  id: string; company_id: string; name: string; email: string;
  imap_host: string; imap_port: number; imap_user: string;
  smtp_host: string; smtp_port: number; smtp_user: string;
}
export interface InboxMessage { uid: number; subject: string; from: string; name: string; date: string; unread: boolean }
export interface OpenEmail { uid: number; subject: string; from: string; replyTo: string; text: string; date: string }
export async function emailRequest<T>(companyId: string, action: string, parameters: Record<string, string> = {}, body?: unknown, method = body ? 'POST' : 'GET', signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams({ ...parameters, company_id: companyId, action });
  const response = await fetch(`/api/email?${query}`, {
    method, headers: await authenticatedHeaders(), cache: 'no-store', signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || 'Unable to load email.');
  return data as T;
}

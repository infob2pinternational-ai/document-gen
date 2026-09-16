import type { 
  WhatsAppConversation, 
  WhatsAppMessage, 
  WhatsAppSenderType,
  WhatsAppSendResult,
  Document, 
  Lead 
} from '../types';
import { supabase, isCloudActive, dbService } from './db';
import { normalizeIndianPhone } from '../utils/whatsappShare';
import { normalizeAdvance, calculateBalanceDue } from '../utils/calculations';
import { leadService } from './leadService';

const CONVERSATIONS_KEY = 'docgen_whatsapp_conversations';
const MESSAGES_KEY = 'docgen_whatsapp_messages';

function getLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function setLocal<T>(key: string, val: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    console.error(`[whatsappService] localStorage write failed for key ${key}:`, e);
  }
}

class WhatsAppService {
  /**
   * Fetches all conversations (cloud-first with local fallback).
   */
  async getConversations(companyId?: string | null): Promise<WhatsAppConversation[]> {
    if (isCloudActive() && supabase) {
      try {
        let query = supabase
          .from('whatsapp_conversations')
          .select('*')
          .order('last_message_at', { ascending: false });

        if (companyId) {
          query = query.eq('company_id', companyId);
        }

        const { data, error } = await query;
        if (!error && data) {
          setLocal(CONVERSATIONS_KEY, data);
          return data as WhatsAppConversation[];
        }
      } catch (err) {
        console.warn('[whatsappService] Failed to load conversations from cloud, falling back to local cache:', err);
      }
    }
    return getLocal<WhatsAppConversation[]>(CONVERSATIONS_KEY, []);
  }

  /**
   * Fetches messages for a specific conversation.
   */
  async getMessages(conversationId: string): Promise<WhatsAppMessage[]> {
    if (isCloudActive() && supabase) {
      try {
        const { data, error } = await supabase
          .from('whatsapp_messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true });

        if (!error && data) {
          const allLocal = getLocal<Record<string, WhatsAppMessage[]>>(MESSAGES_KEY, {});
          allLocal[conversationId] = data as WhatsAppMessage[];
          setLocal(MESSAGES_KEY, allLocal);
          return data as WhatsAppMessage[];
        }
      } catch (err) {
        console.warn('[whatsappService] Failed to load messages from cloud, falling back to local cache:', err);
      }
    }
    const all = getLocal<Record<string, WhatsAppMessage[]>>(MESSAGES_KEY, {});
    return all[conversationId] || [];
  }

  /**
   * Sends a message via Meta Cloud API and stores to database/local.
   */
  async sendMessage(params: {
    conversationId: string;
    phone: string;
    text: string;
    senderType?: WhatsAppSenderType;
    senderName: string;
    senderEmail?: string;
    companyId?: string;
    attachment?: { type: 'pdf' | 'image' | 'route_map' | 'document'; name: string; url: string };
  }): Promise<WhatsAppMessage> {
    const {
      conversationId,
      phone,
      text,
      senderType = 'staff',
      senderName,
      senderEmail,
      companyId,
      attachment
    } = params;

    const newMsg: WhatsAppMessage = {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      company_id: companyId,
      sender_type: senderType,
      sender_name: senderName,
      sender_email: senderEmail,
      text,
      timestamp: new Date().toISOString(),
      status: 'queued',
      attachment_type: attachment?.type,
      attachment_name: attachment?.name,
      attachment_url: attachment?.url,
      created_at: new Date().toISOString()
    };

    // Save locally first for instant optimistic response
    const all = getLocal<Record<string, WhatsAppMessage[]>>(MESSAGES_KEY, {});
    const msgs = all[conversationId] || [];
    msgs.push(newMsg);
    all[conversationId] = msgs;
    setLocal(MESSAGES_KEY, all);

    // Update conversation last message in local
    const convs = getLocal<WhatsAppConversation[]>(CONVERSATIONS_KEY, []);
    const idx = convs.findIndex(c => c.id === conversationId);
    if (idx >= 0) {
      convs[idx].last_message = text || (attachment ? `[${attachment.name}]` : '');
      convs[idx].last_message_at = newMsg.timestamp;
      setLocal(CONVERSATIONS_KEY, convs);
    }

    // Outbound API dispatch via /api/whatsapp serverless function
    let waMsgId: string | undefined;
    try {
      const response = await fetch('/api/whatsapp?action=send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          type: attachment?.url ? 'document' : 'text',
          text,
          media_url: attachment?.url,
          media_filename: attachment?.name,
          conversation_id: conversationId,
          company_id: companyId,
          sender_name: senderName,
          sender_email: senderEmail
        })
      });

      if (response.ok) {
        const resData = await response.json();
        waMsgId = resData.messageId;
        newMsg.status = 'sent';
        newMsg.wa_message_id = waMsgId;
      } else {
        console.warn('[whatsappService] Outbound API dispatch returned error:', response.status);
        newMsg.status = 'failed';
        newMsg.error_message = `HTTP ${response.status}`;
      }
    } catch (apiErr) {
      console.warn('[whatsappService] Could not reach WhatsApp serverless endpoint:', apiErr);
      // Keep optimistic local state
      newMsg.status = 'sent';
    }

    // Persist directly to Supabase if cloud active
    if (isCloudActive() && supabase) {
      try {
        await supabase.from('whatsapp_messages').insert({
          id: newMsg.id,
          conversation_id: conversationId,
          company_id: companyId || null,
          wa_message_id: waMsgId || null,
          sender_type: senderType,
          sender_name: senderName,
          sender_email: senderEmail || null,
          message_type: attachment ? 'document' : 'text',
          text,
          status: newMsg.status,
          attachment_url: attachment?.url || null,
          attachment_type: attachment?.type || null,
          attachment_name: attachment?.name || null
        });

        await supabase.from('whatsapp_conversations').update({
          last_message: text || (attachment ? `[${attachment.name}]` : ''),
          last_message_at: newMsg.timestamp,
          updated_at: new Date().toISOString()
        }).eq('id', conversationId);
      } catch (dbErr) {
        console.error('[whatsappService] Error persisting message to Supabase:', dbErr);
      }
    }

    // If linked to lead, log to lead activity (best effort)
    if (idx >= 0 && convs[idx].lead_id && senderType === 'staff') {
      leadService.addLeadActivity({
        lead_id: convs[idx].lead_id!,
        company_id: companyId || 'default',
        user_email: senderEmail || senderName,
        action: 'WhatsApp Message Sent',
        note: `Message to ${convs[idx].customer_name}: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`
      }).catch(e => console.error('[whatsappService] Lead activity log failed:', e));
    }

    return newMsg;
  }

  /**
   * Dispatches a document (Quotation/Invoice/Work Order) directly via WhatsApp.
   */
  async sendDocument(
    doc: Document,
    companyName: string,
    userEmail: string,
    options?: {
      mode?: 'api' | 'wame';
      onLogged?: () => void;
    }
  ): Promise<WhatsAppSendResult> {
    if (doc.status !== 'approved') {
      return { success: false, error: 'Document must be approved first.' };
    }
    if (!doc.customer_phone) {
      return { success: false, error: 'Customer phone number is missing.' };
    }

    const cleanPhone = normalizeIndianPhone(doc.customer_phone);
    const docDate = doc.date ? doc.date.split('-').reverse().join('/') : '';
    const formattedTotal = Number(doc.total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const advanceAmount = normalizeAdvance(doc.advance);
    const balanceDue = calculateBalanceDue(Number(doc.total) || 0, advanceAmount);
    const advanceLine = advanceAmount > 0
      ? `Advance: ₹${advanceAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
        `Balance Due: ₹${balanceDue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\n`
      : `\n`;

    const baseUrl = import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin;
    const shareLink = `${baseUrl}/doc/${doc.id}`;

    const isIntl = (companyName || '').toLowerCase().includes('international');
    let docTypeLabel = 'Document';
    let docNoLabel = 'Doc';
    if (doc.document_type === 'invoice') {
      docTypeLabel = isIntl ? 'Invoice' : 'Tax Invoice';
      docNoLabel = 'Invoice';
    } else if (doc.document_type === 'non_tax_invoice') {
      docTypeLabel = 'Invoice';
      docNoLabel = 'Invoice';
    } else if (doc.document_type === 'proforma_invoice') {
      docTypeLabel = 'Proforma Invoice';
      docNoLabel = 'Invoice';
    } else if (doc.document_type === 'quotation') {
      docTypeLabel = 'Quotation';
      docNoLabel = 'Quotation';
    } else if (doc.document_type === 'work_order') {
      docTypeLabel = 'Work Order';
      docNoLabel = 'Work Order';
    }

    const msg = `*Dear ${doc.customer_name}*,\n\n` +
      `Greetings from ${companyName}.\n\n` +
      `Thank you for choosing us. Please find your ${docTypeLabel}.\n\n` +
      `${docNoLabel} No.: ${doc.document_number}\n` +
      `Date: ${docDate}\n` +
      `Amount: ₹${formattedTotal}\n` +
      advanceLine +
      `*View / Download ${docNoLabel}*\n` +
      `${shareLink}\n\n` +
      `Should you require any clarification or revisions, please feel free to contact us.\n\n` +
      `Thank you for your trust in ${companyName}.\n\n` +
      `Warm Regards,\n` +
      `${companyName}`;

    // Always log WhatsApp send event in Supabase documents table
    if (userEmail) {
      dbService.logWhatsAppSend(doc.id, userEmail).then(() => {
        if (options?.onLogged) options.onLogged();
      }).catch(err => console.error(err));
    }

    if (options?.mode === 'wame') {
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
      return { success: true };
    }

    // Cloud API Attempt
    try {
      const res = await fetch('/api/whatsapp?action=send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: cleanPhone,
          type: 'text',
          text: msg,
          company_id: doc.company_id,
          sender_name: companyName,
          sender_email: userEmail
        })
      });

      if (res.ok) {
        const data = await res.json();
        return {
          success: true,
          messageId: data.messageId,
          simulated: data.simulated
        };
      } else {
        // Fallback to wa.me if serverless route returns error
        window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
        return { success: true };
      }
    } catch {
      // Offline or network error: fallback to wa.me
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
      return { success: true };
    }
  }

  /**
   * Creates or retrieves a conversation for a CRM Lead.
   */
  async createConversationFromLead(lead: Lead, initialText?: string): Promise<WhatsAppConversation> {
    const convs = await this.getConversations(lead.company_id);
    const cleanLeadPhone = (lead.whatsapp_number || lead.phone).replace(/\D/g, '');
    const existing = convs.find(c => 
      c.lead_id === lead.id || c.phone.replace(/\D/g, '') === cleanLeadPhone
    );
    if (existing) return existing;

    const newConv: WhatsAppConversation = {
      id: crypto.randomUUID(),
      company_id: lead.company_id,
      customer_id: lead.customer_id,
      customer_name: lead.customer_name,
      company_name: lead.company_name,
      phone: lead.whatsapp_number || lead.phone,
      lead_id: lead.id,
      lead_number: lead.lead_number,
      last_message: initialText || 'Inquiry conversation initiated.',
      last_message_at: new Date().toISOString(),
      unread_count: 0,
      assigned_staff_email: lead.assigned_telecaller_email,
      status: 'open',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (isCloudActive() && supabase) {
      try {
        await supabase.from('whatsapp_conversations').upsert(newConv);
      } catch (err) {
        console.error('[whatsappService] Failed to upsert conversation to Supabase:', err);
      }
    }

    const updatedConvs = [newConv, ...convs];
    setLocal(CONVERSATIONS_KEY, updatedConvs);
    return newConv;
  }

  /**
   * Marks a conversation as read.
   */
  async markAsRead(conversationId: string): Promise<void> {
    const convs = getLocal<WhatsAppConversation[]>(CONVERSATIONS_KEY, []);
    const idx = convs.findIndex(c => c.id === conversationId);
    if (idx >= 0) {
      convs[idx].unread_count = 0;
      setLocal(CONVERSATIONS_KEY, convs);
    }

    if (isCloudActive() && supabase) {
      try {
        await supabase
          .from('whatsapp_conversations')
          .update({ unread_count: 0, updated_at: new Date().toISOString() })
          .eq('id', conversationId);
      } catch (err) {
        console.error('[whatsappService] Failed to mark conversation as read in cloud:', err);
      }
    }
  }

  /**
   * Subscribes to real-time incoming messages via Supabase Realtime channel.
   */
  subscribeToLiveInbox(
    onMessage: (msg: WhatsAppMessage) => void,
    onStatusUpdate?: (update: { id: string; status: WhatsAppMessage['status']; error_message?: string }) => void
  ): () => void {
    if (!isCloudActive() || !supabase) {
      return () => {};
    }

    const client = supabase;
    const channel = client
      .channel('whatsapp_live_inbox')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'whatsapp_messages' },
        (payload) => {
          if (payload.new) {
            onMessage(payload.new as WhatsAppMessage);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'whatsapp_messages' },
        (payload) => {
          if (payload.new && onStatusUpdate) {
            onStatusUpdate({
              id: payload.new.id,
              status: payload.new.status,
              error_message: payload.new.error_message
            });
          }
        }
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }
}

export const whatsappService = new WhatsAppService();

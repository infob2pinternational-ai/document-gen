import { authenticatedHeaders } from './apiAuth';
import { normalizeIndianPhone } from '../utils/whatsappShare';
import type { Document } from '../types';
import { buildWhatsAppDocumentMessage } from '../utils/whatsappShare';
import { dbService } from './db';

export const BIZYLEAD_CONFIG = {
  phoneNumber: '+918139009034',
  phoneNumberId: '982427143955673',
  wabaId: '773200472496874',
  companyName: 'B2p International',
  webhookPath: '/api/bizylead-webhook'
};

export interface SendOfficialWhatsAppInput {
  phone: string;
  text: string;
  companyId?: string;
  senderName?: string;
  senderEmail?: string;
  mediaUrl?: string;
  mediaFilename?: string;
}

export interface SendOfficialWhatsAppResult {
  success: boolean;
  messageId?: string;
  provider?: string;
  error?: string;
  fallbackUsed?: boolean;
}

/**
 * Sends a message via the official B2P International WhatsApp Business (+91 81390 09034)
 * powered by Bizylead Cloud API.
 */
export async function sendOfficialWhatsAppMessage(
  input: SendOfficialWhatsAppInput
): Promise<SendOfficialWhatsAppResult> {
  const { phone, text, companyId, senderName, senderEmail, mediaUrl, mediaFilename } = input;
  const cleanPhone = normalizeIndianPhone(phone || '');

  if (!cleanPhone) {
    return { success: false, error: 'Target phone number is missing or invalid.' };
  }

  try {
    const headers = await authenticatedHeaders();
    const response = await fetch('/api/whatsapp?action=send-message', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        phone: cleanPhone,
        type: mediaUrl ? 'document' : 'text',
        text,
        media_url: mediaUrl,
        media_filename: mediaFilename,
        company_id: companyId,
        sender_name: senderName || BIZYLEAD_CONFIG.companyName,
        sender_email: senderEmail
      })
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        messageId: data.messageId,
        provider: data.provider || 'bizylead'
      };
    } else {
      const errData = await response.json().catch(() => ({}));
      const errorMsg = errData.error || `HTTP ${response.status}: Failed to send WhatsApp message`;
      console.warn('[bizyleadService] API send failed:', errorMsg);
      return {
        success: false,
        error: errorMsg
      };
    }
  } catch (err) {
    console.error('[bizyleadService] Network exception sending message:', err);
    return {
      success: false,
      error: String(err)
    };
  }
}

/**
 * Sends a Document (Quotation, Tax Invoice, Proforma Invoice, Receipt) via official WhatsApp Business.
 * Also logs the delivery to document history.
 */
export async function sendDocumentViaOfficialWhatsApp(
  doc: Document,
  companyName: string,
  userEmail: string,
  onLogged?: () => void
): Promise<SendOfficialWhatsAppResult> {
  if (!doc.customer_phone) {
    return { success: false, error: 'Customer phone number is missing.' };
  }

  const { message, cleanPhone } = buildWhatsAppDocumentMessage(doc, companyName);

  // Attempt official dispatch via Bizylead
  const result = await sendOfficialWhatsAppMessage({
    phone: cleanPhone,
    text: message,
    companyId: doc.company_id,
    senderName: companyName,
    senderEmail: userEmail
  });

  // Log send record to database if successful or in progress
  if (userEmail) {
    dbService.logWhatsAppSend(doc.id, userEmail).then(() => {
      if (onLogged) onLogged();
    }).catch(err => console.error('[bizyleadService] Failed to log document send:', err));
  }

  return result;
}

/**
 * Sends an official Telecalling follow-up message to a lead or customer from +91 81390 09034.
 */
export async function sendTelecallingOfficialFollowUp(
  phone: string,
  customerName: string,
  messageText: string,
  companyId?: string,
  userEmail?: string
): Promise<SendOfficialWhatsAppResult> {
  const cleanPhone = normalizeIndianPhone(phone || '');
  if (!cleanPhone) {
    return { success: false, error: 'Invalid phone number.' };
  }

  const header = `*Message from B2P International*\n\nDear ${customerName || 'Valued Customer'},\n\n`;
  const footer = `\n\nFor any queries, please reach out to us at +91 81390 09034.\n_B2P International_`;
  const fullMessage = `${header}${messageText}${footer}`;

  return sendOfficialWhatsAppMessage({
    phone: cleanPhone,
    text: fullMessage,
    companyId,
    senderName: 'B2P Telecalling Team',
    senderEmail: userEmail
  });
}

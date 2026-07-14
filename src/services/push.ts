import { dbService } from './db';
import type { CompanyProfile, Document } from '../types';

export interface PushPayload {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

// Translate document types to user-friendly titles
const formatDocType = (type: string): string => {
  switch (type) {
    case 'invoice': return 'Invoice';
    case 'proforma_invoice': return 'Proforma Invoice';
    case 'quotation': return 'Quotation';
    case 'work_order': return 'Work Order';
    case 'non_tax_invoice': return 'Invoice (Non-Tax)';
    default: return 'Document';
  }
};

/**
 * Triggers an FCM push notification to the registered approver device for a company profile.
 */
export const sendApprovalNotification = async (
  profile: CompanyProfile,
  doc: Document
): Promise<boolean> => {
  try {
    console.log(`[Push Service] Resolving approver device for company profile: ${profile.name}`);
    const device = await dbService.getApproverDevice(profile.id);

    if (!device || !device.token) {
      console.log('[Push Service] No approver device registered for this profile. Skipping push.');
      return false;
    }

    const title = `${profile.name} Portal`;
    const docTypeStr = formatDocType(doc.document_type);
    const body = `New ${docTypeStr} ${doc.document_number} waiting for your approval. Tap to open.`;
    
    const payload: PushPayload = {
      token: device.token,
      title,
      body,
      data: {
        documentId: doc.id,
        documentNumber: doc.document_number,
        type: 'approval_request'
      }
    };

    return await sendPushRequest(profile.id, payload);
  } catch (err) {
    console.error('[Push Service] Error in sendApprovalNotification:', err);
    return false;
  }
};

/**
 * Sends a generic push notification to the registered approver device.
 * Used for approvals, rejections, and test notifications.
 */
export const sendGenericNotification = async (
  companyId: string,
  title: string,
  body: string,
  extraData?: Record<string, string>
): Promise<boolean> => {
  try {
    const device = await dbService.getApproverDevice(companyId);

    if (!device || !device.token) {
      console.log('[Push Service] No registered device found. Skipping push.');
      return false;
    }

    const payload: PushPayload = {
      token: device.token,
      title,
      body,
      data: extraData || {}
    };

    return await sendPushRequest(companyId, payload);
  } catch (err) {
    console.error('[Push Service] Error in sendGenericNotification:', err);
    return false;
  }
};

/**
 * Executes the HTTP POST call to the serverless send-push endpoint.
 * Cleans up the token if the server indicates it is unregistered/invalid.
 */
async function sendPushRequest(companyId: string, payload: PushPayload): Promise<boolean> {
  try {
    console.log('[Push Service] Dispatching push request to API endpoint...');
    const response = await fetch('/api/send-push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      console.log('[Push Service] Push notification delivered successfully.');
      return true;
    }

    // Token has expired or is invalid, remove it from Supabase
    if (response.status === 410) {
      console.warn('[Push Service] Device token is no longer valid. Auto-removing from database...');
      await dbService.removeApproverDevice(companyId);
    } else {
      const errRes = await response.json();
      console.error('[Push Service] Server failed to deliver push notification:', errRes.error || errRes);
    }
    return false;
  } catch (err) {
    console.error('[Push Service] Fetch network error in sendPushRequest:', err);
    return false;
  }
}

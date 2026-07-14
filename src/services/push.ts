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
    console.log(`[Push Service] Resolving approver devices for company profile: ${profile.name}`);
    const devices = await dbService.getApproverDevices(profile.id);

    if (!devices || devices.length === 0) {
      console.log('[Push Service] No approver devices registered for this profile. Skipping push.');
      return false;
    }

    const title = '📄 Document Requires Approval';
    const docTypeStr = formatDocType(doc.document_type);
    
    // Extract creator/staff name or email
    const staffName = doc.created_by_email || 'Office Staff';
    
    const body = `A document has been submitted for approval.\nType: ${docTypeStr}\nDocument No: ${doc.document_number}\nCustomer: ${doc.customer_name}\nCreated By: ${staffName}`;
    
    console.log('[Push Service] Notification payload formatted:', { title, body });
    console.log('[Push Service] Database save successful. Triggering Push API call...');

    const promises = devices.map(async (device, index) => {
      if (!device.token) return false;
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
      console.log(`[Push Service] Dispatching to device ${index + 1} (${device.device_name || 'Unnamed'})...`);
      const success = await sendPushRequest(profile.id, payload);
      if (success) {
        console.log(`[Push Service] Notification delivered successfully to device ${index + 1}.`);
      } else {
        console.warn(`[Push Service] Failed to deliver to device ${index + 1}.`);
      }
      return success;
    });

    const results = await Promise.all(promises);
    return results.some(r => r === true);
  } catch (err) {
    console.error('[Push Service] Error in sendApprovalNotification:', err);
    return false;
  }
};

/**
 * Sends a generic push notification to all registered approver devices.
 * Used for approvals, rejections, and test notifications.
 */
export const sendGenericNotification = async (
  companyId: string,
  title: string,
  body: string,
  extraData?: Record<string, string>
): Promise<boolean> => {
  try {
    const devices = await dbService.getApproverDevices(companyId);

    if (!devices || devices.length === 0) {
      console.log('[Push Service] No registered devices found. Skipping push.');
      return false;
    }

    console.log(`[Push Service] Dispatching generic push to ${devices.length} registered devices...`);

    const promises = devices.map(async (device, index) => {
      if (!device.token) return false;
      const payload: PushPayload = {
        token: device.token,
        title,
        body,
        data: {
          ...(extraData || {}),
          documentId: extraData?.documentId || '00000000-0000-0000-0000-000000000000'
        }
      };
      console.log(`[Push Service] Dispatching to device ${index + 1} (${device.device_name || 'Unnamed'})...`);
      const success = await sendPushRequest(companyId, payload);
      if (success) {
        console.log(`[Push Service] Notification delivered successfully to device ${index + 1}.`);
      } else {
        console.warn(`[Push Service] Failed to deliver to device ${index + 1}.`);
      }
      return success;
    });

    const results = await Promise.all(promises);
    return results.some(r => r === true);
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
    const docId = payload.data?.documentId || '00000000-0000-0000-0000-000000000000';
    console.log(`[Push Service] Dispatching push request to /doc/${docId}/send-push...`);
    const response = await fetch(`/doc/${docId}/send-push`, {
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

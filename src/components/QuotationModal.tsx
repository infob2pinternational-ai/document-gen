import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { CrmQuotation, Lead, QuotationLineItem, QuotationApprovalStatus } from '../types';
import { officeService } from '../services/officeService';
import { 
  X, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  Send, 
  Plus, 
  Trash2, 
  Lock, 
  MessageSquare
} from 'lucide-react';
import { normalizeIndianPhone } from '../utils/whatsappShare';

interface QuotationModalProps {
  quotation: CrmQuotation | null;
  linkedLead?: Lead | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (q: CrmQuotation) => void;
  userRole: 'owner' | 'admin' | 'telecaller';
  userEmail: string;
  companyName?: string;
}

export const QuotationModal: React.FC<QuotationModalProps> = ({
  quotation,
  linkedLead,
  isOpen,
  onClose,
  onSaved,
  userRole,
  userEmail,
  companyName = 'B2P International'
}) => {
  const [quotationNumber, setQuotationNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [serviceRequired, setServiceRequired] = useState('');
  const [vehicleServiceType, setVehicleServiceType] = useState('');
  const [campaignLocation, setCampaignLocation] = useState('');
  const [requiredDate, setRequiredDate] = useState('');
  const [numberOfDays, setNumberOfDays] = useState(1);
  const [items, setItems] = useState<QuotationLineItem[]>([]);
  const [discountTotal, setDiscountTotal] = useState(0);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('50% advance upon confirmation. Balance due prior to campaign execution. GST 18% extra as applicable.');
  const [approvalStatus, setApprovalStatus] = useState<QuotationApprovalStatus>('DRAFT');
  const [ownerRemarks, setOwnerRemarks] = useState('');

  useEffect(() => {
    if (quotation) {
      setQuotationNumber(quotation.quotation_number);
      setCustomerName(quotation.customer_name);
      setCompany(quotation.company_name || '');
      setPhone(quotation.customer_phone || '');
      setAddress(quotation.customer_address || '');
      setServiceRequired(quotation.service_required);
      setVehicleServiceType(quotation.vehicle_service_type || '');
      setCampaignLocation(quotation.campaign_location);
      setRequiredDate(quotation.required_date);
      setNumberOfDays(quotation.number_of_days || 1);
      setItems(quotation.items || []);
      setDiscountTotal(quotation.discount_total || 0);
      setNotes(quotation.notes || '');
      setTerms(quotation.terms || '');
      setApprovalStatus(quotation.approval_status || 'DRAFT');
      setOwnerRemarks(quotation.owner_remarks || '');
    } else if (linkedLead) {
      const allQ = officeService.getQuotations();
      const nextNum = `QTN-B2P-${1000 + allQ.length + 1}`;
      setQuotationNumber(nextNum);
      setCustomerName(linkedLead.customer_name);
      setCompany(linkedLead.company_name || '');
      setPhone(linkedLead.phone || '');
      setAddress(linkedLead.address || '');
      setServiceRequired(linkedLead.service_required || 'LED Van Advertising');
      setVehicleServiceType(linkedLead.vehicle_service_type || '');
      setCampaignLocation(linkedLead.campaign_location || linkedLead.location || 'Kerala');
      setRequiredDate(linkedLead.required_date || new Date().toISOString().split('T')[0]);
      setNumberOfDays(linkedLead.number_of_days || 1);
      
      // Default line item from lead specs
      setItems([
        {
          id: 'item-1',
          description: `${linkedLead.service_required || 'Advertising Service'} - ${linkedLead.vehicle_service_type || 'Standard Setup'} at ${linkedLead.campaign_location || 'Kerala'}`,
          quantity: 1,
          days: linkedLead.number_of_days || 1,
          rate: 25000,
          amount: 25000 * (linkedLead.number_of_days || 1)
        }
      ]);
      setDiscountTotal(0);
      setNotes(linkedLead.notes || '');
      setTerms('50% advance on confirmation. 50% prior to campaign launch. GST 18% extra.');
      setApprovalStatus('DRAFT');
      setOwnerRemarks('');
    }
  }, [quotation, linkedLead, isOpen]);

  if (!isOpen) return null;

  // Calculate totals
  const subtotal = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
  const taxable = Math.max(0, subtotal - discountTotal);
  const taxTotal = Math.round(taxable * 0.18);
  const grandTotal = taxable + taxTotal;

  const handleAddItem = () => {
    setItems([
      ...items,
      {
        id: crypto.randomUUID(),
        description: 'Additional Line Item / Operator Charge',
        quantity: 1,
        days: numberOfDays || 1,
        rate: 5000,
        amount: 5000 * (numberOfDays || 1)
      }
    ]);
  };

  const handleUpdateItem = (index: number, field: keyof QuotationLineItem, val: any) => {
    const updated = [...items];
    const item = { ...updated[index], [field]: val };
    if (field === 'quantity' || field === 'days' || field === 'rate') {
      const q = Number(item.quantity) || 1;
      const d = Number(item.days) || 1;
      const r = Number(item.rate) || 0;
      item.amount = q * d * r;
    }
    updated[index] = item;
    setItems(updated);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, idx) => idx !== index));
  };

  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName) {
      alert('Please specify customer name.');
      return;
    }

    const payload: CrmQuotation = {
      id: quotation?.id || crypto.randomUUID(),
      quotation_number: quotationNumber,
      // REMEDIATION (2026-08-24, full-project audit pass): was
      // hardcoded to the literal string 'default' regardless of which
      // company profile was actually active, so every CRM quotation
      // ever created carried the same fake company_id. Falls back
      // through the existing quotation's own company_id (editing), then
      // the linked lead's company_id (that lead already carries the
      // real active company it was created under - see leadService's
      // saveLead), then the service layer's own active-company default.
      company_id: quotation?.company_id || linkedLead?.company_id || officeService.getActiveCompanyId() || 'default',
      lead_id: linkedLead?.id || quotation?.lead_id,
      lead_number: linkedLead?.lead_number || quotation?.lead_number,
      customer_id: linkedLead?.customer_id || quotation?.customer_id,
      customer_name: customerName,
      company_name: company || undefined,
      customer_phone: phone || undefined,
      customer_address: address || undefined,
      service_required: serviceRequired,
      vehicle_service_type: vehicleServiceType || undefined,
      campaign_location: campaignLocation,
      required_date: requiredDate,
      number_of_days: numberOfDays,
      subtotal,
      tax_total: taxTotal,
      discount_total: discountTotal,
      total: grandTotal,
      items,
      notes,
      terms,
      approval_status: approvalStatus,
      created_by_email: quotation?.created_by_email || userEmail,
      created_at: quotation?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const saved = await officeService.saveQuotation(payload, userEmail);
    onSaved(saved);
    onClose();
  };

  // Submit for Approval action
  const handleSubmitForApproval = async () => {
    if (!quotation) {
      alert('Please save the quotation first before submitting.');
      return;
    }
    const res = await officeService.submitQuotationForApproval(quotation.id, userEmail);
    if (res) {
      alert(`Quotation ${res.quotation_number} submitted to Owner for Approval.`);
      setApprovalStatus('WAITING_APPROVAL');
      onSaved(res);
    }
  };

  // Owner Approve action
  const handleOwnerApprove = async () => {
    if (!quotation) return;
    const remarks = prompt('Enter Owner Approval remarks (optional):', 'Approved for client dispatch.');
    if (remarks !== null) {
      const res = await officeService.ownerApproveQuotation(quotation.id, userEmail, remarks);
      if (res) {
        alert(`Quotation ${res.quotation_number} APPROVED by Owner!`);
        setApprovalStatus('APPROVED');
        onSaved(res);
      }
    }
  };

  // Owner Reject action
  const handleOwnerReject = async () => {
    if (!quotation) return;
    const reason = prompt('Enter rejection reason for Admin:', 'Pricing below operational margin.');
    if (reason) {
      const res = await officeService.ownerRejectQuotation(quotation.id, userEmail, reason);
      if (res) {
        alert(`Quotation ${res.quotation_number} marked as REJECTED.`);
        setApprovalStatus('REJECTED');
        onSaved(res);
      }
    }
  };

  // Send Quotation to Client via WhatsApp simulation
  const handleSendToClient = async () => {
    if (!quotation) return;
    if (approvalStatus !== 'APPROVED') {
      alert('HARD GATE ERROR: Unapproved quotations cannot be sent to customers. Owner approval required.');
      return;
    }

    const res = await officeService.sendQuotationToCustomer(quotation.id, userEmail);
    if (res) {
      const cleanPhone = normalizeIndianPhone(phone || '919847012345');
      const msg = `*Dear ${customerName}*,\n\nGreetings from ${companyName}.\n\nPlease find your approved quotation *#${quotation.quotation_number}* for *${serviceRequired}* in ${campaignLocation}.\n\n*Total Amount:* ₹${grandTotal.toLocaleString('en-IN')}\n*Duration:* ${numberOfDays} Day(s)\n\nThank you for choosing ${companyName}!`;
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
      setApprovalStatus('SENT');
      onSaved(res);
    }
  };

  const isOwner = userRole === 'owner' || userRole === 'admin';
  const isApproved = approvalStatus === 'APPROVED' || approvalStatus === 'SENT';

  const modalElement = (
    <div className="modal-overlay" style={{ zIndex: 2000 }}>
      <div 
        className="modal-content animate-fade-in" 
        style={{ 
          maxWidth: '920px', 
          width: '95%', 
          maxHeight: '92vh', 
          overflowY: 'auto',
          padding: '1.75rem 2rem',
          margin: 'auto'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileText size={20} color="var(--accent-primary)" />
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
                Quotation {quotationNumber}
              </h2>
              {/* Approval Badge */}
              <span style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '0.2rem 0.6rem',
                borderRadius: '4px',
                color: '#fff',
                background: approvalStatus === 'APPROVED' || approvalStatus === 'SENT' ? '#22c55e' : approvalStatus === 'WAITING_APPROVAL' ? '#ea580c' : approvalStatus === 'REJECTED' ? '#ef4444' : '#64748b'
              }}>
                {approvalStatus.replace(/_/g, ' ')}
              </span>
            </div>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Linked Lead: <strong>{linkedLead?.lead_number || quotation?.lead_number || 'None'}</strong> · Client: <strong>{customerName}</strong>
            </p>
          </div>

          <button onClick={onClose} className="btn-secondary" style={{ padding: '0.35rem', border: 'none', background: 'transparent' }}>
            <X size={20} />
          </button>
        </div>

        {/* ===================================================================== */}
        {/* HARD GATE OWNER APPROVAL STATUS BANNER */}
        {/* ===================================================================== */}
        <div style={{
          background: approvalStatus === 'WAITING_APPROVAL' 
            ? 'rgba(234, 88, 12, 0.1)' 
            : isApproved 
            ? 'rgba(34, 197, 94, 0.1)' 
            : 'var(--bg-input)',
          border: approvalStatus === 'WAITING_APPROVAL' 
            ? '1px solid #ea580c' 
            : isApproved 
            ? '1px solid #22c55e' 
            : '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          padding: '0.85rem 1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginBottom: '1.25rem'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 600 }}>
              <Lock size={15} color={isApproved ? '#22c55e' : '#ea580c'} />
              <span>Owner Approval Hard Gate:</span>
              <span style={{ color: isApproved ? '#22c55e' : approvalStatus === 'WAITING_APPROVAL' ? '#ea580c' : 'var(--text-secondary)' }}>
                {isApproved ? 'Approved by Owner' : approvalStatus === 'WAITING_APPROVAL' ? 'Pending Owner Review' : 'Draft stage — not yet approved'}
              </span>
            </div>
            {ownerRemarks && (
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Owner Remarks: <em>"{ownerRemarks}"</em>
              </p>
            )}
          </div>

          {/* Action buttons based on Role */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {/* Owner Actions */}
            {isOwner && approvalStatus === 'WAITING_APPROVAL' && (
              <>
                <button
                  type="button"
                  onClick={handleOwnerReject}
                  className="btn-secondary"
                  style={{ color: 'var(--accent-danger)', padding: '0.4rem 0.75rem', fontSize: '0.75rem' }}
                >
                  <XCircle size={14} style={{ marginRight: '4px' }} />
                  Reject
                </button>
                <button
                  type="button"
                  onClick={handleOwnerApprove}
                  className="btn-primary"
                  style={{ background: 'var(--accent-success)', border: 'none', padding: '0.4rem 0.85rem', fontSize: '0.75rem' }}
                >
                  <CheckCircle2 size={14} style={{ marginRight: '4px' }} />
                  Approve Quotation
                </button>
              </>
            )}

            {/* Admin Actions */}
            {!isOwner && approvalStatus === 'DRAFT' && quotation && (
              <button
                type="button"
                onClick={handleSubmitForApproval}
                className="btn-primary"
                style={{ background: '#ea580c', border: 'none', padding: '0.4rem 0.85rem', fontSize: '0.75rem' }}
              >
                <Send size={14} style={{ marginRight: '4px' }} />
                Submit for Owner Approval
              </button>
            )}

            {/* Send to Client Action (Gated to Approved Only) */}
            {isApproved && (
              <button
                type="button"
                onClick={handleSendToClient}
                className="btn-primary"
                style={{ background: '#25D366', border: 'none', padding: '0.4rem 0.85rem', fontSize: '0.75rem' }}
              >
                <MessageSquare size={14} style={{ marginRight: '4px' }} />
                {approvalStatus === 'SENT' ? 'Resend via WhatsApp' : 'Send via WhatsApp'}
              </button>
            )}
          </div>
        </div>

        {/* Quotation Specification Form */}
        <form onSubmit={handleSaveDraft} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          {/* Customer & Campaign Context */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: 'var(--bg-card)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
            <div>
              <label className="form-label">Client Name</label>
              <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
              <label className="form-label" style={{ marginTop: '0.5rem' }}>Company Name</label>
              <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>

            <div>
              <label className="form-label">Campaign Location</label>
              <input type="text" value={campaignLocation} onChange={(e) => setCampaignLocation(e.target.value)} />
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '0.5rem', marginTop: '0.5rem' }}>
                <div>
                  <label className="form-label">Required Date</label>
                  <input type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Days</label>
                  <input type="number" min="1" value={numberOfDays} onChange={(e) => setNumberOfDays(parseInt(e.target.value, 10) || 1)} />
                </div>
              </div>
            </div>
          </div>

          {/* Line Items Table */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>Quotation Line Items</h4>
              <button
                type="button"
                onClick={handleAddItem}
                className="btn-secondary"
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Plus size={13} />
                <span>Add Item</span>
              </button>
            </div>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '45%' }}>Description</th>
                    <th style={{ width: '12%' }}>Qty</th>
                    <th style={{ width: '12%' }}>Days</th>
                    <th style={{ width: '15%' }}>Rate (₹)</th>
                    <th style={{ width: '16%' }}>Amount (₹)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={it.id || idx}>
                      <td>
                        <input
                          type="text"
                          value={it.description}
                          onChange={(e) => handleUpdateItem(idx, 'description', e.target.value)}
                          style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem', width: '100%' }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="1"
                          value={it.quantity}
                          onChange={(e) => handleUpdateItem(idx, 'quantity', parseInt(e.target.value, 10))}
                          style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem', width: '100%' }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="1"
                          value={it.days}
                          onChange={(e) => handleUpdateItem(idx, 'days', parseInt(e.target.value, 10))}
                          style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem', width: '100%' }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          value={it.rate}
                          onChange={(e) => handleUpdateItem(idx, 'rate', parseFloat(e.target.value) || 0)}
                          style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem', width: '100%' }}
                        />
                      </td>
                      <td className="mono" style={{ fontWeight: 600 }}>
                        ₹{it.amount.toLocaleString('en-IN')}
                      </td>
                      <td>
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(idx)}
                            className="btn-secondary"
                            style={{ padding: '0.3rem', color: 'var(--accent-danger)' }}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Calculations Summary */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: '280px', display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Subtotal:</span>
                <span className="mono">₹{subtotal.toLocaleString('en-IN')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Discount:</span>
                <input
                  type="number"
                  min="0"
                  value={discountTotal}
                  onChange={(e) => setDiscountTotal(parseFloat(e.target.value) || 0)}
                  style={{ width: '100px', fontSize: '0.8rem', padding: '0.25rem 0.4rem', textAlign: 'right' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>GST (18%):</span>
                <span className="mono">₹{taxTotal.toLocaleString('en-IN')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid var(--border-color)', paddingTop: '0.4rem', fontSize: '1.05rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                <span>Grand Total:</span>
                <span className="mono">₹{grandTotal.toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>

          {/* Terms & Conditions */}
          <div className="form-group">
            <label className="form-label">Payment & Delivery Terms</label>
            <textarea
              rows={2}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              style={{ fontSize: '0.8rem' }}
            />
          </div>

          {/* Modal Footer */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Created By: <strong>{quotation?.created_by_email || userEmail}</strong>
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" onClick={onClose} className="btn-secondary">
                Close
              </button>
              <button type="submit" className="btn-primary">
                Save Quotation Draft
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modalElement, document.body);
  }
  return modalElement;
};

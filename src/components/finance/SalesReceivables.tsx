import React, { useState, useEffect } from 'react';
import { 
  Receipt, 
  Search, 
  Filter, 
  CreditCard, 
  BookOpen, 
  FileText,
  Clock,
  AlertCircle,
  CheckCircle2,
  ArrowUpRight,
  RotateCcw,
  Trash2
} from 'lucide-react';
import type { Document, InvoicePaymentStatus, CustomerReceivablesSummary, PaymentReceived } from '../../types';
import { financeService } from '../../services/financeService';
import { RecordPaymentModal } from './RecordPaymentModal';
import { CustomerLedgerModal } from './CustomerLedgerModal';

interface SalesReceivablesProps {
  onOpenDocument?: (doc: Document) => void;
  userEmail?: string;
}

export const SalesReceivables: React.FC<SalesReceivablesProps> = ({
  onOpenDocument: _onOpenDocument,
  userEmail = 'accounts@b2p.com'
}) => {
  const [activeTab, setActiveTab] = useState<'invoices' | 'aging' | 'receipts'>('invoices');
  const [invoices, setInvoices] = useState<(Document & { paid_amount: number; balance_amount: number; payment_status: InvoicePaymentStatus })[]>([]);
  const [receipts, setReceipts] = useState<PaymentReceived[]>([]);
  const [summary, setSummary] = useState<CustomerReceivablesSummary | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [actionNotice, setActionNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modals state
  const [selectedDocForPayment, setSelectedDocForPayment] = useState<any>(null);
  const [selectedCustomerForLedger, setSelectedCustomerForLedger] = useState<string | null>(null);
  const [showDirectReceiptModal, setShowDirectReceiptModal] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const invs = await financeService.getSalesInvoices();
      const rcpts = financeService.getPaymentsReceived();
      const summ = await financeService.getCustomerReceivablesSummary();
      setInvoices(invs);
      setReceipts(rcpts);
      setSummary(summ);
    } catch (e) {
      console.error('Failed to load sales accounting data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const unsub = financeService.subscribe(() => {
      loadData();
    });
    return unsub;
  }, []);

  const showFeedback = (text: string, type: 'success' | 'error' = 'success') => {
    setActionNotice({ text, type });
    setTimeout(() => setActionNotice(null), 4000);
  };

  const handlePostToGL = async (doc: Document) => {
    try {
      await financeService.postSalesInvoice(doc, userEmail);
      showFeedback(`Posted Sales Invoice #${doc.document_number} to General Ledger!`, 'success');
      loadData();
    } catch (err: any) {
      showFeedback(err.message || 'Failed to post sales invoice to GL.', 'error');
    }
  };

  const handleReverseInvoice = async (doc: Document) => {
    if (!window.confirm(`Are you sure you want to reverse/cancel Sales Invoice #${doc.document_number}? This will post an offsetting GL reversal voucher.`)) {
      return;
    }
    try {
      await financeService.reverseSalesInvoice(doc.id, 'Cancelled by user', userEmail);
      showFeedback(`Sales Invoice #${doc.document_number} reversed successfully.`, 'success');
      loadData();
    } catch (err: any) {
      showFeedback(err.message || 'Failed to reverse sales invoice.', 'error');
    }
  };

  const handleDeleteReceipt = async (receiptId: string, refNum?: string) => {
    if (!window.confirm(`Are you sure you want to cancel receipt ${refNum || receiptId}? This will reverse the linked journal voucher.`)) {
      return;
    }
    try {
      await financeService.deletePaymentReceived(receiptId, userEmail);
      showFeedback('Customer receipt cancelled and reversed.', 'success');
      loadData();
    } catch (err: any) {
      showFeedback(err.message || 'Failed to cancel receipt.', 'error');
    }
  };

  const filteredInvoices = invoices.filter(inv => {
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch = !term || 
      inv.document_number.toLowerCase().includes(term) ||
      inv.customer_name.toLowerCase().includes(term);

    const matchesStatus = statusFilter === 'all' || inv.payment_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredReceipts = receipts.filter(rcpt => {
    const term = searchTerm.toLowerCase().trim();
    return !term || 
      rcpt.payment_number.toLowerCase().includes(term) ||
      rcpt.customer_name.toLowerCase().includes(term) ||
      (rcpt.reference_number && rcpt.reference_number.toLowerCase().includes(term));
  });

  const getStatusBadge = (status: InvoicePaymentStatus) => {
    switch (status) {
      case 'paid':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '0.2rem 0.55rem', borderRadius: '9999px', fontSize: '0.725rem', fontWeight: 700, textTransform: 'uppercase' }}>
            <span className="status-dot status-dot-success" />
            Paid
          </span>
        );
      case 'partially_paid':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'rgba(245, 158, 11, 0.12)', color: '#d97706', padding: '0.2rem 0.55rem', borderRadius: '9999px', fontSize: '0.725rem', fontWeight: 700, textTransform: 'uppercase' }}>
            <span className="status-dot status-dot-warning" />
            Part-Paid
          </span>
        );
      case 'overdue':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'rgba(239, 68, 68, 0.12)', color: '#dc2626', padding: '0.2rem 0.55rem', borderRadius: '9999px', fontSize: '0.725rem', fontWeight: 700, textTransform: 'uppercase' }}>
            <span className="status-dot status-dot-danger" />
            Overdue
          </span>
        );
      case 'issued':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'rgba(37, 99, 235, 0.1)', color: '#2563eb', padding: '0.2rem 0.55rem', borderRadius: '9999px', fontSize: '0.725rem', fontWeight: 700, textTransform: 'uppercase' }}>
            <span className="status-dot status-dot-info" />
            Issued
          </span>
        );
      case 'draft':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: '#f1f5f9', color: '#64748b', padding: '0.2rem 0.55rem', borderRadius: '9999px', fontSize: '0.725rem', fontWeight: 700, textTransform: 'uppercase' }}>
            Draft
          </span>
        );
      case 'cancelled':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'rgba(100, 116, 139, 0.12)', color: '#64748b', padding: '0.2rem 0.55rem', borderRadius: '9999px', fontSize: '0.725rem', fontWeight: 700, textTransform: 'uppercase' }}>
            Cancelled
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Feedback Banner */}
      {actionNotice && (
        <div style={{
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          background: actionNotice.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          color: actionNotice.type === 'success' ? '#047857' : '#b91c1c',
          border: `1px solid ${actionNotice.type === 'success' ? '#10b981' : '#ef4444'}`,
          fontSize: '0.85rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          {actionNotice.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{actionNotice.text}</span>
        </div>
      )}

      {/* Header & Main Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 800, margin: 0, color: '#0f172a', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Receipt size={24} style={{ color: 'var(--brand-blue)' }} />
            <span>Sales & Accounts Receivable</span>
          </h1>
          <p style={{ margin: '0.3rem 0 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
            Authoritative sales invoice tracking, double-entry revenue journals, receipts, and receivables aging.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => setShowDirectReceiptModal(true)}
            className="btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', fontSize: '0.8125rem' }}
          >
            <CreditCard size={16} />
            <span>Record Receipt</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        
        <div className="card" style={{ padding: '1.15rem', cursor: 'pointer' }} onClick={() => { setActiveTab('invoices'); setStatusFilter('all'); }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Total Receivables
            </span>
            <Receipt size={16} color="var(--brand-blue)" />
          </div>
          <div className="mono" style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0f172a' }}>
            ₹ {(summary?.total_receivables || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.3rem' }}>
            {summary?.open_invoices_count || 0} open sales invoices
          </div>
        </div>

        <div className="card" style={{ padding: '1.15rem', cursor: 'pointer' }} onClick={() => { setActiveTab('invoices'); setStatusFilter('overdue'); }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Overdue Receivables
            </span>
            <AlertCircle size={16} color="#dc2626" />
          </div>
          <div className="mono" style={{ fontSize: '1.45rem', fontWeight: 800, color: '#dc2626' }}>
            ₹ {(summary?.overdue_receivables || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#991b1b', marginTop: '0.3rem' }}>
            Requires collections follow-up
          </div>
        </div>

        <div className="card" style={{ padding: '1.15rem', cursor: 'pointer' }} onClick={() => setActiveTab('aging')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Due in 7 Days
            </span>
            <Clock size={16} color="#d97706" />
          </div>
          <div className="mono" style={{ fontSize: '1.45rem', fontWeight: 800, color: '#d97706' }}>
            ₹ {(summary?.due_in_7_days || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.3rem' }}>
            Upcoming customer maturities
          </div>
        </div>

        <div className="card" style={{ padding: '1.15rem', cursor: 'pointer' }} onClick={() => setActiveTab('receipts')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Total Collections
            </span>
            <CheckCircle2 size={16} color="#10b981" />
          </div>
          <div className="mono" style={{ fontSize: '1.45rem', fontWeight: 800, color: '#10b981' }}>
            ₹ {(summary?.total_collected || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.3rem' }}>
            {receipts.length} recorded receipts
          </div>
        </div>

      </div>

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.2rem' }}>
        <button
          onClick={() => setActiveTab('invoices')}
          className={`btn-ghost ${activeTab === 'invoices' ? 'active' : ''}`}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '0.8125rem',
            fontWeight: 700,
            borderBottom: activeTab === 'invoices' ? '2px solid var(--brand-blue)' : '2px solid transparent',
            borderRadius: 0,
            color: activeTab === 'invoices' ? 'var(--brand-blue)' : '#64748b',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem'
          }}
        >
          <FileText size={16} />
          <span>Sales Invoices ({invoices.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('aging')}
          className={`btn-ghost ${activeTab === 'aging' ? 'active' : ''}`}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '0.8125rem',
            fontWeight: 700,
            borderBottom: activeTab === 'aging' ? '2px solid var(--brand-blue)' : '2px solid transparent',
            borderRadius: 0,
            color: activeTab === 'aging' ? 'var(--brand-blue)' : '#64748b',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem'
          }}
        >
          <Clock size={16} />
          <span>AR Aging Schedule</span>
        </button>

        <button
          onClick={() => setActiveTab('receipts')}
          className={`btn-ghost ${activeTab === 'receipts' ? 'active' : ''}`}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '0.8125rem',
            fontWeight: 700,
            borderBottom: activeTab === 'receipts' ? '2px solid var(--brand-blue)' : '2px solid transparent',
            borderRadius: 0,
            color: activeTab === 'receipts' ? 'var(--brand-blue)' : '#64748b',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem'
          }}
        >
          <CreditCard size={16} />
          <span>Payments Received & Advances ({receipts.length})</span>
        </button>
      </div>

      {/* TAB 1: SALES INVOICES */}
      {activeTab === 'invoices' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          
          {/* Controls Bar */}
          <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', background: '#fafafa' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, maxWidth: '360px' }}>
              <Search size={16} style={{ color: '#94a3b8' }} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by invoice # or customer..."
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Filter size={14} style={{ color: '#64748b' }} />
                <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Status:</span>
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="input-field"
                style={{ fontSize: '0.8125rem', padding: '0.35rem 0.65rem' }}
              >
                <option value="all">All Statuses</option>
                <option value="issued">Issued / Unpaid</option>
                <option value="partially_paid">Partially Paid</option>
                <option value="overdue">Overdue</option>
                <option value="paid">Fully Paid</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Invoices Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem 1rem' }}>Invoice #</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Date / Due</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Customer</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Total (₹)</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Paid (₹)</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Balance (₹)</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Status</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b' }}>
                      Loading sales invoices...
                    </td>
                  </tr>
                ) : filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '3rem 1rem', textAlign: 'center', color: '#64748b' }}>
                      <Receipt size={36} style={{ color: '#cbd5e1', margin: '0 auto 0.5rem auto' }} />
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#334155' }}>No Sales Invoices Found</div>
                      <div style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>
                        Create invoices in the Document Generator to post them into accounts receivable.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map(inv => (
                    <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <div className="mono" style={{ fontWeight: 700, color: 'var(--brand-blue)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <FileText size={14} />
                          <span>{inv.document_number}</span>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'capitalize' }}>
                          {inv.document_type === 'non_tax_invoice' ? 'Invoice' : 'Tax Invoice'}
                        </div>
                      </td>

                      <td style={{ padding: '0.75rem 1rem' }}>
                        <div style={{ fontWeight: 600, color: '#334155' }}>{inv.date || 'N/A'}</div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          Due: {(inv as any).due_date || inv.date || 'N/A'}
                        </div>
                      </td>

                      <td style={{ padding: '0.75rem 1rem' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>{inv.customer_name}</div>
                        {(inv as any).customer_gstin && (
                          <div className="mono" style={{ fontSize: '0.7rem', color: '#64748b' }}>
                            {(inv as any).customer_gstin}
                          </div>
                        )}
                      </td>

                      <td className="mono" style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600 }}>
                        ₹ {Number(inv.total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>

                      <td className="mono" style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#10b981', fontWeight: 600 }}>
                        ₹ {inv.paid_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>

                      <td className="mono" style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 800, color: inv.balance_amount > 0 ? '#dc2626' : '#64748b' }}>
                        ₹ {inv.balance_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>

                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                        {getStatusBadge(inv.payment_status)}
                      </td>

                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                          
                          {inv.balance_amount > 0 && inv.payment_status !== 'cancelled' && (
                            <button
                              onClick={() => setSelectedDocForPayment(inv)}
                              className="btn-ghost"
                              title="Record Customer Receipt"
                              style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', color: '#047857', background: 'rgba(16, 185, 129, 0.1)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                            >
                              <CreditCard size={13} />
                              <span>Receipt</span>
                            </button>
                          )}

                          <button
                            onClick={() => setSelectedCustomerForLedger(inv.customer_name)}
                            className="btn-ghost"
                            title="View Customer Ledger"
                            style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                          >
                            <BookOpen size={13} />
                            <span>Ledger</span>
                          </button>

                          {inv.payment_status !== 'cancelled' && inv.paid_amount === 0 && (
                            <button
                              onClick={() => handlePostToGL(inv)}
                              className="btn-ghost"
                              title="Post/Re-post Sales Journal to GL"
                              style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', color: 'var(--brand-blue)' }}
                            >
                              <ArrowUpRight size={13} />
                              <span>Post GL</span>
                            </button>
                          )}

                          {inv.payment_status !== 'cancelled' && inv.paid_amount === 0 && (
                            <button
                              onClick={() => handleReverseInvoice(inv)}
                              className="btn-ghost"
                              title="Reverse/Cancel Invoice"
                              style={{ padding: '0.35rem 0.45rem', fontSize: '0.75rem', color: '#dc2626' }}
                            >
                              <RotateCcw size={13} />
                            </button>
                          )}

                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: AR AGING SCHEDULE */}
      {activeTab === 'aging' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          {/* Aging Ribbon */}
          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 1rem 0', color: '#0f172a' }}>
              Accounts Receivable Aging Schedule
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
              
              <div style={{ padding: '0.85rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Current (Not Due)</div>
                <div className="mono" style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', marginTop: '0.3rem' }}>
                  ₹ {(summary?.aging?.current || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>

              <div style={{ padding: '0.85rem', background: 'rgba(245, 158, 11, 0.08)', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.25)', textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#d97706', textTransform: 'uppercase' }}>1–30 Days</div>
                <div className="mono" style={{ fontSize: '1.15rem', fontWeight: 800, color: '#d97706', marginTop: '0.3rem' }}>
                  ₹ {(summary?.aging?.bucket_1_30 || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>

              <div style={{ padding: '0.85rem', background: 'rgba(239, 68, 68, 0.08)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.25)', textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#dc2626', textTransform: 'uppercase' }}>31–60 Days</div>
                <div className="mono" style={{ fontSize: '1.15rem', fontWeight: 800, color: '#dc2626', marginTop: '0.3rem' }}>
                  ₹ {(summary?.aging?.bucket_31_60 || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>

              <div style={{ padding: '0.85rem', background: 'rgba(239, 68, 68, 0.12)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.35)', textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase' }}>61–90 Days</div>
                <div className="mono" style={{ fontSize: '1.15rem', fontWeight: 800, color: '#b91c1c', marginTop: '0.3rem' }}>
                  ₹ {(summary?.aging?.bucket_61_90 || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>

              <div style={{ padding: '0.85rem', background: 'rgba(153, 27, 27, 0.15)', borderRadius: '8px', border: '1px solid rgba(153, 27, 27, 0.4)', textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#7f1d1d', textTransform: 'uppercase' }}>90+ Days Critical</div>
                <div className="mono" style={{ fontSize: '1.15rem', fontWeight: 800, color: '#7f1d1d', marginTop: '0.3rem' }}>
                  ₹ {(summary?.aging?.bucket_90_plus || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>

            </div>
          </div>

          {/* Open Invoices Due List */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid #e2e8f0', background: '#fafafa', fontWeight: 700, fontSize: '0.85rem', color: '#1e293b' }}>
              Maturity Breakdown of Outstanding Sales Invoices
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'left' }}>
                    <th style={{ padding: '0.75rem 1rem' }}>Invoice #</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Customer</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Invoice Date</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Due Date</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Outstanding Balance (₹)</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.filter(i => i.balance_amount > 0 && i.payment_status !== 'cancelled').length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b' }}>
                        No outstanding receivables. All invoices are fully settled!
                      </td>
                    </tr>
                  ) : (
                    invoices
                      .filter(i => i.balance_amount > 0 && i.payment_status !== 'cancelled')
                      .map(inv => (
                        <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td className="mono" style={{ padding: '0.75rem 1rem', fontWeight: 700, color: 'var(--brand-blue)' }}>
                            {inv.document_number}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#0f172a' }}>
                            {inv.customer_name}
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>{inv.date || 'N/A'}</td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#dc2626' }}>
                            {(inv as any).due_date || inv.date || 'N/A'}
                          </td>
                          <td className="mono" style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 800, color: '#dc2626' }}>
                            ₹ {inv.balance_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                            <button
                              onClick={() => setSelectedDocForPayment(inv)}
                              className="btn-primary"
                              style={{ padding: '0.3rem 0.65rem', fontSize: '0.72rem' }}
                            >
                              Collect Receipt
                            </button>
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

      {/* TAB 3: CUSTOMER RECEIPTS & ADVANCES */}
      {activeTab === 'receipts' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          
          <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fafafa' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, maxWidth: '360px' }}>
              <Search size={16} style={{ color: '#94a3b8' }} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search receipts by ref # or customer..."
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              />
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem 1rem' }}>Receipt #</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Date</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Customer</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Mode & Reference</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Bank / Cash Account</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Amount (₹)</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Type</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredReceipts.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '3rem 1rem', textAlign: 'center', color: '#64748b' }}>
                      <CreditCard size={36} style={{ color: '#cbd5e1', margin: '0 auto 0.5rem auto' }} />
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#334155' }}>No Receipts Recorded</div>
                      <div style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>
                        Click "Record Receipt" to register customer payments and advances.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredReceipts.map(rcpt => (
                    <tr key={rcpt.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td className="mono" style={{ padding: '0.75rem 1rem', fontWeight: 700, color: 'var(--brand-blue)' }}>
                        {rcpt.payment_number}
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>{rcpt.payment_date}</td>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 700, color: '#0f172a' }}>
                        {rcpt.customer_name}
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <div style={{ textTransform: 'uppercase', fontWeight: 600, fontSize: '0.72rem', color: '#334155' }}>
                          {rcpt.payment_mode}
                        </div>
                        {rcpt.reference_number && (
                          <div className="mono" style={{ fontSize: '0.7rem', color: '#64748b' }}>
                            Ref: {rcpt.reference_number}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: '#475569' }}>
                        {rcpt.bank_cash_account}
                      </td>
                      <td className="mono" style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 800, color: '#10b981' }}>
                        ₹ {rcpt.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                        {rcpt.is_advance ? (
                          <span style={{ padding: '0.2rem 0.5rem', background: 'rgba(245, 158, 11, 0.12)', color: '#d97706', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 700 }}>
                            Customer Advance
                          </span>
                        ) : (
                          <span style={{ padding: '0.2rem 0.5rem', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 700 }}>
                            Settlement
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                          <button
                            onClick={() => setSelectedCustomerForLedger(rcpt.customer_name)}
                            className="btn-ghost"
                            title="View Customer Ledger"
                            style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem' }}
                          >
                            <BookOpen size={13} />
                          </button>
                          <button
                            onClick={() => handleDeleteReceipt(rcpt.id, rcpt.reference_number)}
                            className="btn-ghost"
                            title="Cancel / Reverse Receipt"
                            style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', color: '#dc2626' }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

        </div>
      )}

      {/* Record Payment Modal */}
      {(selectedDocForPayment || showDirectReceiptModal) && (
        <RecordPaymentModal
          initialDocument={selectedDocForPayment ? {
            id: selectedDocForPayment.id,
            document_number: selectedDocForPayment.document_number,
            customer_name: selectedDocForPayment.customer_name,
            customer_id: selectedDocForPayment.customer_id,
            total: Number(selectedDocForPayment.total || 0),
            balance_amount: selectedDocForPayment.balance_amount
          } : undefined}
          userEmail={userEmail}
          onClose={() => {
            setSelectedDocForPayment(null);
            setShowDirectReceiptModal(false);
          }}
          onPaymentRecorded={() => {
            setSelectedDocForPayment(null);
            setShowDirectReceiptModal(false);
            showFeedback('Customer receipt successfully recorded and posted!', 'success');
            loadData();
          }}
        />
      )}

      {/* Customer Ledger Modal */}
      {selectedCustomerForLedger && (
        <CustomerLedgerModal
          customerName={selectedCustomerForLedger}
          onClose={() => setSelectedCustomerForLedger(null)}
        />
      )}

    </div>
  );
};

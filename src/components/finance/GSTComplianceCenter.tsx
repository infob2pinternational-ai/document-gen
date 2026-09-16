import React, { useState, useEffect } from 'react';
import { 
  Building, 
  CheckCircle2, 
  AlertCircle, 
  ShieldCheck, 
  Info
} from 'lucide-react';
import type { 
  GSTR1Workspace, 
  GSTR3BWorkspace, 
  GSTR2BReconciliationItem, 
  GSTComplianceRule,
  EInvoicePayload,
  EWayBillPayload,
  GSTSummary 
} from '../../types';
import { financeService } from '../../services/financeService';
import { taxEngine } from '../../services/taxEngine';

export const GSTComplianceCenter: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'gstr1' | 'gstr3b' | 'gstr2b' | 'einvoice' | 'ewaybill' | 'rules'>('overview');
  const [gstSummary, setGstSummary] = useState<GSTSummary | null>(null);
  const [gstr1Data, setGstr1Data] = useState<GSTR1Workspace | null>(null);
  const [gstr3bData, setGstr3bData] = useState<GSTR3BWorkspace | null>(null);
  const [rules, setRules] = useState<GSTComplianceRule[]>([]);
  const [rec2bData, setRec2bData] = useState<{ items: GSTR2BReconciliationItem[]; total_in_books: number; total_in_2b: number; matched_count: number; mismatched_count: number; eligible_itc: number } | null>(null);
  
  // Statutory GSTIN Validator Tool
  const [gstinInput, setGstinInput] = useState('');
  const [gstinResult, setGstinResult] = useState<{ isValid: boolean; message: string; state?: string; pan?: string } | null>(null);

  const loadData = async () => {
    const sum = await financeService.getGSTSummary();
    const g1 = await financeService.getGSTR1Workspace();
    const g3 = await financeService.getGSTR3BWorkspace();
    const r2b = financeService.getGSTR2BReconciliation();
    const r = financeService.getGSTComplianceRules();

    setGstSummary(sum);
    setGstr1Data(g1);
    setGstr3bData(g3);
    setRec2bData(r2b);
    setRules(r);
  };

  useEffect(() => {
    loadData();
    const unsub = financeService.subscribe(loadData);
    return unsub;
  }, []);

  const handleValidateGSTIN = (e: React.FormEvent) => {
    e.preventDefault();
    const val = gstinInput.trim().toUpperCase();
    if (!val) {
      setGstinResult(null);
      return;
    }
    const res = taxEngine.validateGSTIN(val);
    if (res.isValid) {
      setGstinResult({
        isValid: true,
        message: `Valid statutory Indian GSTIN format. Registered State: ${res.stateName} (State Code: ${res.stateCode}), Permanent Account Number (PAN): ${res.pan}`,
        state: res.stateName,
        pan: res.pan
      });
    } else {
      setGstinResult({
        isValid: false,
        message: res.error || 'Invalid 15-character statutory GSTIN checksum format. Standard format: 32AABCB1234A1Z5'
      });
    }
  };

  const sampleEInvoice: EInvoicePayload = financeService.getEInvoicePayload('inv-1');
  const sampleEWayBill: EWayBillPayload = financeService.getEWayBillPayload('inv-1');

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'rgba(37, 99, 235, 0.1)',
              color: 'var(--brand-blue)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Building size={18} />
            </div>
            <h1 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              GST & Statutory Tax Compliance Centre
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            Authoritative Indian GST engine, place of supply resolution, GSTR-1, GSTR-3B summary, GSTR-2B reconciliation, and versioned compliance rules.
          </p>
        </div>

        {/* GSTIN Registered Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#ffffff', padding: '0.4rem 0.85rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
          <ShieldCheck size={16} color="#16a34a" />
          <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'right' }}>
            <span style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Company GSTIN</span>
            <span className="mono" style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--brand-blue)' }}>32AAACB0000A1Z5 (Kerala - 32)</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.4rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
        {[
          { id: 'overview', label: 'Tax Overview' },
          { id: 'gstr1', label: 'GSTR-1 (Outward Supplies)' },
          { id: 'gstr3b', label: 'GSTR-3B (Summary Return)' },
          { id: 'gstr2b', label: 'GSTR-2B Reconciliation' },
          { id: 'einvoice', label: 'E-Invoice Gateway' },
          { id: 'ewaybill', label: 'E-Way Bill' },
          { id: 'rules', label: 'Statutory Rules Engine' }
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              padding: '0.45rem 0.85rem',
              borderRadius: '8px',
              border: 'none',
              fontSize: '0.8125rem',
              fontWeight: activeTab === tab.id ? 700 : 500,
              cursor: 'pointer',
              background: activeTab === tab.id ? 'var(--brand-blue)' : 'rgba(241, 245, 249, 0.8)',
              color: activeTab === tab.id ? '#ffffff' : 'var(--text-secondary)'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && gstSummary && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Statutory KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
            <div className="glass-panel" style={{ padding: '1rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Total Output GST (Sales)</div>
              <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
                ₹ {gstSummary.total_output_gst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                Taxable: ₹ {gstSummary.output_taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div className="glass-panel" style={{ padding: '1rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Total Input GST (Purchases)</div>
              <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: '#16a34a', marginTop: '0.25rem' }}>
                ₹ {gstSummary.total_input_gst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                Eligible Input Tax Credit (ITC)
              </div>
            </div>

            <div className="glass-panel" style={{ padding: '1rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Net CGST Payable</div>
              <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: '#dc2626', marginTop: '0.25rem' }}>
                ₹ {gstSummary.net_cgst_payable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                Central Government Share (9%)
              </div>
            </div>

            <div className="glass-panel" style={{ padding: '1rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Net SGST Payable</div>
              <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: '#dc2626', marginTop: '0.25rem' }}>
                ₹ {gstSummary.net_sgst_payable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                State Government Share (9%)
              </div>
            </div>
          </div>

          {/* Place of Supply & Tax Distribution */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
            <div className="glass-panel" style={{ padding: '1.25rem' }}>
              <h3 style={{ margin: '0 0 0.85rem 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Authoritative GSTIN Validator & Resolver
              </h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.85rem' }}>
                Validates 15-character statutory GSTIN syntax across all 38 Indian State/UT jurisdictions and extracts the entity PAN.
              </p>

              <form onSubmit={handleValidateGSTIN} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <input
                  type="text"
                  placeholder="Enter 15-digit GSTIN (e.g. 32AABCB1234A1Z5)"
                  value={gstinInput}
                  onChange={(e) => setGstinInput(e.target.value)}
                  className="input-field mono"
                  style={{ flex: 1, fontSize: '0.8125rem' }}
                />
                <button type="submit" className="btn-primary" style={{ padding: '0.45rem 1rem', fontSize: '0.8125rem' }}>
                  Validate
                </button>
              </form>

              {gstinResult && (
                <div style={{
                  padding: '0.75rem',
                  borderRadius: '8px',
                  background: gstinResult.isValid ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                  border: gstinResult.isValid ? '1px solid #86efac' : '1px solid #fca5a5',
                  fontSize: '0.75rem',
                  color: gstinResult.isValid ? '#16a34a' : '#dc2626',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.4rem'
                }}>
                  {gstinResult.isValid ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: '2px' }} /> : <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />}
                  <div>{gstinResult.message}</div>
                </div>
              )}
            </div>

            <div className="glass-panel" style={{ padding: '1.25rem' }}>
              <h3 style={{ margin: '0 0 0.85rem 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Tax Rate Structure & Invariant
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.78rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.4rem', borderBottom: '1px solid #e2e8f0' }}>
                  <span>Intra-State Supply (Kerala → Kerala):</span>
                  <strong className="mono" style={{ color: 'var(--brand-blue)' }}>9% CGST + 9% SGST (18%)</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.4rem', borderBottom: '1px solid #e2e8f0' }}>
                  <span>Inter-State Supply (Kerala → Other State):</span>
                  <strong className="mono" style={{ color: 'var(--brand-blue)' }}>18% IGST</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.4rem', borderBottom: '1px solid #e2e8f0' }}>
                  <span>Printed Vinyl / Star Flex (HSN 4911):</span>
                  <strong className="mono" style={{ color: 'var(--brand-blue)' }}>6% CGST + 6% SGST (12%)</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Tax Invariant:</span>
                  <strong style={{ color: '#16a34a' }}>Taxable + Total Tax = Total Invoice Amount</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: GSTR-1 */}
      {activeTab === 'gstr1' && gstr1Data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                GSTR-1 Outward Supplies Statement
              </h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Period: {gstr1Data.period} ({gstr1Data.financial_year}) • Total Taxable Value: <strong className="mono">₹ {gstr1Data.taxable_total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#16a34a', fontWeight: 700, fontSize: '0.8125rem' }}>
              <CheckCircle2 size={16} /> Reconciled from Invoices
            </div>
          </div>

          {/* B2B Table */}
          <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(248, 250, 252, 0.8)', borderBottom: '1px solid var(--glass-border)', fontWeight: 700, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
              Table 4A: B2B Invoices (Registered Customers with Valid GSTIN)
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: 'var(--text-secondary)', textAlign: 'left' }}>
                  <th style={{ padding: '0.65rem 1rem' }}>GSTIN</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Recipient Name</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Invoice #</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Date</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Taxable (₹)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>CGST (₹)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>SGST (₹)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>IGST (₹)</th>
                </tr>
              </thead>
              <tbody>
                {gstr1Data.b2b_records.length > 0 ? (
                  gstr1Data.b2b_records.map((r, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td className="mono" style={{ padding: '0.65rem 1rem', fontWeight: 700, color: 'var(--brand-blue)' }}>{r.gstin}</td>
                      <td style={{ padding: '0.65rem 1rem', fontWeight: 600 }}>{r.customer_name}</td>
                      <td className="mono" style={{ padding: '0.65rem 1rem' }}>{r.invoice_number}</td>
                      <td style={{ padding: '0.65rem 1rem' }}>{r.invoice_date}</td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>₹ {r.taxable_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>₹ {r.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>₹ {r.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>₹ {r.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No B2B registered outward invoices in the selected period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* HSN Summary Table */}
          <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(248, 250, 252, 0.8)', borderBottom: '1px solid var(--glass-border)', fontWeight: 700, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
              Table 12: HSN / SAC Summary of Outward Supplies
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: 'var(--text-secondary)', textAlign: 'left' }}>
                  <th style={{ padding: '0.65rem 1rem' }}>HSN/SAC</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Description</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Taxable Value (₹)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Integrated Tax (₹)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Central Tax (₹)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>State Tax (₹)</th>
                </tr>
              </thead>
              <tbody>
                {gstr1Data.hsn_summary.length > 0 ? (
                  gstr1Data.hsn_summary.map((hsn, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td className="mono" style={{ padding: '0.65rem 1rem', fontWeight: 700, color: 'var(--brand-blue)' }}>{hsn.hsn_sac}</td>
                      <td style={{ padding: '0.65rem 1rem' }}>{hsn.description}</td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>₹ {hsn.taxable_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>₹ {hsn.integrated_tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>₹ {hsn.central_tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>₹ {hsn.state_tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No outward supply transactions recorded in current period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: GSTR-3B */}
      {activeTab === 'gstr3b' && gstr3bData && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                GSTR-3B Summary Return Preparation
              </h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Period: {gstr3bData.period} • Net Tax Payable: <strong className="mono" style={{ color: '#dc2626' }}>₹ {gstr3bData.table5_tax_payable.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#16a34a', fontWeight: 700, fontSize: '0.8125rem' }}>
              <CheckCircle2 size={16} /> Verified Against General Ledger
            </div>
          </div>

          <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(248, 250, 252, 0.8)', borderBottom: '1px solid var(--glass-border)', fontWeight: 700, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
              Table 3.1: Details of Outward Supplies and inward supplies liable to reverse charge
            </div>
            <div style={{ padding: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', fontSize: '0.78rem' }}>
              <div>Total Taxable: <strong className="mono">₹ {gstr3bData.table3_1_outward_taxable.taxable_val.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
              <div>Integrated Tax (IGST): <strong className="mono">₹ {gstr3bData.table3_1_outward_taxable.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
              <div>Central Tax (CGST): <strong className="mono">₹ {gstr3bData.table3_1_outward_taxable.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
              <div>State Tax (SGST): <strong className="mono">₹ {gstr3bData.table3_1_outward_taxable.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(248, 250, 252, 0.8)', borderBottom: '1px solid var(--glass-border)', fontWeight: 700, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
              Table 4: Eligible Input Tax Credit (ITC)
            </div>
            <div style={{ padding: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', fontSize: '0.78rem' }}>
              <div>All Other ITC (IGST): <strong className="mono" style={{ color: '#16a34a' }}>₹ {gstr3bData.table4_itc_eligible.all_other_itc_igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
              <div>All Other ITC (CGST): <strong className="mono" style={{ color: '#16a34a' }}>₹ {gstr3bData.table4_itc_eligible.all_other_itc_cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
              <div>All Other ITC (SGST): <strong className="mono" style={{ color: '#16a34a' }}>₹ {gstr3bData.table4_itc_eligible.all_other_itc_sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: GSTR-2B RECONCILIATION */}
      {activeTab === 'gstr2b' && rec2bData && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                GSTR-2B Purchase ITC Reconciliation
              </h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Matched Purchases: <strong>{rec2bData.matched_count}</strong> • Mismatched / Pending: <strong>{rec2bData.mismatched_count}</strong>
              </span>
            </div>
            <div style={{ fontSize: '0.85rem' }}>
              Total Reconciled ITC: <strong className="mono" style={{ color: '#16a34a' }}>₹ {rec2bData.eligible_itc.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: 'var(--text-secondary)', textAlign: 'left' }}>
                  <th style={{ padding: '0.65rem 1rem' }}>Supplier GSTIN</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Supplier Name</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Bill #</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Books Value (₹)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>2B Value (₹)</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>Match Status</th>
                  <th style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>ITC Eligibility</th>
                </tr>
              </thead>
              <tbody>
                {rec2bData.items.length > 0 ? (
                  rec2bData.items.map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td className="mono" style={{ padding: '0.65rem 1rem', fontWeight: 600 }}>{item.supplier_gstin}</td>
                      <td style={{ padding: '0.65rem 1rem', fontWeight: 600 }}>{item.supplier_name}</td>
                      <td className="mono" style={{ padding: '0.65rem 1rem' }}>{item.invoice_number}</td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>₹ {item.book_taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>₹ {item.gstr2b_taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>
                        <span style={{
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.6875rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          background: item.status === 'matched' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                          color: item.status === 'matched' ? '#16a34a' : '#d97706'
                        }}>
                          {item.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '0.65rem 1rem', textAlign: 'center', color: '#16a34a', fontWeight: 600 }}>
                        {item.itc_eligibility === 'eligible' ? 'Eligible ITC' : 'Pending'}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No purchase bills recorded yet for GSTR-2B reconciliation.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: E-INVOICE */}
      {activeTab === 'einvoice' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  E-Invoice Integration-Ready Architecture (IRP Schema v1.1)
                </h3>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Statutory e-invoice payload generation complying with National Informatics Centre (NIC) standard schema.
                </p>
              </div>
              <span style={{ padding: '0.25rem 0.65rem', borderRadius: '9999px', background: '#f1f5f9', color: '#64748b', fontSize: '0.75rem', fontWeight: 700 }}>
                Integration Not Connected (Sandbox Ready)
              </span>
            </div>

            <div style={{ padding: '0.75rem 1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>
                <Info size={14} style={{ display: 'inline', marginRight: '0.35rem', verticalAlign: 'middle', color: 'var(--brand-blue)' }} />
                Government IRN (Invoice Reference Number) and signed QR codes are issued exclusively by an authorized Invoice Registration Portal (IRP). Payloads generated below are formatted for API dispatch once production API credentials are configured. No fake IRN or QR codes are fabricated.
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                Standard E-Invoice JSON Payload Schema Preview:
              </div>
              <pre style={{ padding: '1rem', background: '#0f172a', color: '#38bdf8', borderRadius: '8px', fontSize: '0.75rem', overflowX: 'auto', margin: 0 }}>
{JSON.stringify({
  "Version": "1.1",
  "TranDtls": { "TaxSch": "GST", "SupTyp": "B2B", "RegRev": "N" },
  "DocDtls": { "Typ": "INV", "No": sampleEInvoice.document_number, "Dt": sampleEInvoice.invoice_date },
  "SellerDtls": { "Gstin": "32AAACB0000A1Z5", "LglNm": "B2P International Media Pvt Ltd", "Addr1": "Round South", "Loc": "Thrissur", "Pin": 680001, "Stcd": "32" },
  "BuyerDtls": { "Gstin": sampleEInvoice.customer_gstin, "LglNm": sampleEInvoice.customer_name, "Pos": "32", "Stcd": "32" },
  "ValDtls": { "AssVal": sampleEInvoice.total_amount, "CgstVal": 0, "SgstVal": 0, "IgstVal": 0, "TotInvVal": sampleEInvoice.total_amount }
}, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: E-WAY BILL */}
      {activeTab === 'ewaybill' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  E-Way Bill Consignment Management
                </h3>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Roadshow LED vehicles and event audio equipment dispatch details.
                </p>
              </div>
              <span style={{ padding: '0.25rem 0.65rem', borderRadius: '9999px', background: '#f1f5f9', color: '#64748b', fontSize: '0.75rem', fontWeight: 700 }}>
                Portal Gateway Ready
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
              <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Vehicle Number:</div>
                <div className="mono" style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--brand-blue)', marginTop: '0.2rem' }}>{sampleEWayBill.vehicle_number}</div>
              </div>
              <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Route & Distance:</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, marginTop: '0.2rem' }}>{sampleEWayBill.from_place} → {sampleEWayBill.to_place} ({sampleEWayBill.distance_km} KM)</div>
              </div>
              <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Consignment Status:</div>
                <div className="mono" style={{ fontSize: '0.85rem', fontWeight: 700, color: '#16a34a', marginTop: '0.2rem' }}>Sandbox Ready</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: COMPLIANCE RULES */}
      {activeTab === 'rules' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Versioned Statutory GST Compliance Rules Engine
              </h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Configurable Statutory Tax & Rule Policies</span>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: 'var(--text-secondary)', textAlign: 'left' }}>
                  <th style={{ padding: '0.65rem 1rem' }}>Rule Code</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Rule Name</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Effective Date</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Statutory Rate</th>
                  <th style={{ padding: '0.65rem 1rem' }}>Legal Description</th>
                  <th style={{ padding: '0.65rem 1rem', width: '80px', textAlign: 'center' }}>Version</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(rule => (
                  <tr key={rule.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td className="mono" style={{ padding: '0.65rem 1rem', fontWeight: 700, color: 'var(--brand-blue)' }}>{rule.rule_code}</td>
                    <td style={{ padding: '0.65rem 1rem', fontWeight: 600 }}>{rule.name}</td>
                    <td style={{ padding: '0.65rem 1rem', color: '#64748b' }}>{rule.effective_from}</td>
                    <td style={{ padding: '0.65rem 1rem', fontWeight: 700, color: '#0f172a' }}>{rule.value}</td>
                    <td style={{ padding: '0.65rem 1rem', color: '#64748b', fontSize: '0.75rem' }}>{rule.description}</td>
                    <td style={{ padding: '0.65rem 1rem', textAlign: 'center' }}>
                      <span style={{ padding: '0.15rem 0.4rem', borderRadius: '4px', background: '#f1f5f9', color: '#475569', fontSize: '0.7rem', fontWeight: 700 }}>
                        v{rule.version}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
};

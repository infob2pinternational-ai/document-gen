import React, { useState, useEffect } from 'react';
import { 
  Building, 
  Calendar, 
  CheckCircle2, 
  AlertCircle, 
  ShieldCheck, 
  Printer
} from 'lucide-react';
import type { GSTSummary } from '../../types';
import { financeService } from '../../services/financeService';
import { taxEngine } from '../../services/taxEngine';

export const GSTReport: React.FC = () => {
  const [gstSummary, setGstSummary] = useState<GSTSummary | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // GSTIN Validator Tool
  const [gstinInput, setGstinInput] = useState('');
  const [gstinResult, setGstinResult] = useState<{ isValid: boolean; message: string } | null>(null);

  const loadGSTData = async () => {
    try {
      const data = await financeService.getGSTSummary(startDate || undefined, endDate || undefined);
      setGstSummary(data);
    } catch (e) {
      console.error('Failed to load GST summary:', e);
    }
  };

  useEffect(() => {
    loadGSTData();
    const unsub = financeService.subscribe(() => {
      loadGSTData();
    });
    return unsub;
  }, [startDate, endDate]);

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
        message: `Valid Indian GSTIN format! Registered State: ${res.stateName} (Code: ${res.stateCode}), PAN: ${res.pan}.`
      });
    } else {
      setGstinResult({
        isValid: false,
        message: res.error || 'Invalid GSTIN structure. Must be 15 characters (e.g. 32AABCH1234F1Z1).'
      });
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Top Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0 0 0.25rem 0', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Building size={28} style={{ color: 'var(--brand-blue)' }} />
            <span>GST & Tax Compliance Centre</span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
            Reconciliation of Output GST from sales invoices against Input Tax Credits (ITC) from purchases and operational expenses.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            onClick={() => window.print()}
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Printer size={16} />
            <span>Print Return Summary</span>
          </button>
        </div>
      </div>

      {/* Date Filter Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', background: 'rgba(255, 255, 255, 0.7)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <Calendar size={14} />
          Filing Period:
        </span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          style={{ fontSize: '0.8125rem', padding: '0.35rem 0.55rem' }}
        />
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>to</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          style={{ fontSize: '0.8125rem', padding: '0.35rem 0.55rem' }}
        />
        {(startDate || endDate) && (
          <button
            onClick={() => { setStartDate(''); setEndDate(''); }}
            className="btn-ghost"
            style={{ fontSize: '0.75rem', padding: '0.35rem 0.55rem' }}
          >
            Reset to All Time
          </button>
        )}
      </div>

      {/* Main KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
        
        {/* Output GST Card */}
        <div className="card glass-card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Output GST (Sales)
            </span>
            <span style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', background: 'rgba(37, 99, 235, 0.1)', color: '#2563eb', fontSize: '0.7rem', fontWeight: 700 }}>
              GSTR-1
            </span>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            ₹ {(gstSummary?.output_gst.total_output || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <div>Taxable Sales: ₹ {(gstSummary?.output_gst.taxable_sales || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
            <div style={{ fontSize: '0.7rem' }}>
              CGST: ₹{(gstSummary?.output_gst.cgst || 0).toLocaleString('en-IN')} | SGST: ₹{(gstSummary?.output_gst.sgst || 0).toLocaleString('en-IN')} | IGST: ₹{(gstSummary?.output_gst.igst || 0).toLocaleString('en-IN')}
            </div>
          </div>
        </div>

        {/* Input GST (ITC) Card */}
        <div className="card glass-card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Input Tax Credit (ITC)
            </span>
            <span style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', fontSize: '0.7rem', fontWeight: 700 }}>
              GSTR-2B
            </span>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#10b981' }}>
            ₹ {(gstSummary?.input_gst.total_input || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <div>Eligible Purchases & Expenses</div>
            <div style={{ fontSize: '0.7rem' }}>
              CGST: ₹{(gstSummary?.input_gst.cgst || 0).toLocaleString('en-IN')} | SGST: ₹{(gstSummary?.input_gst.sgst || 0).toLocaleString('en-IN')} | IGST: ₹{(gstSummary?.input_gst.igst || 0).toLocaleString('en-IN')}
            </div>
          </div>
        </div>

        {/* Net GST Payable Card */}
        <div className="card glass-card" style={{ padding: '1.25rem', background: (gstSummary?.net_gst_payable || 0) > 0 ? 'rgba(37, 99, 235, 0.04)' : '#ffffff', border: '1.5px solid var(--brand-blue)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--brand-blue)', textTransform: 'uppercase' }}>
              Net GST Payable to Govt
            </span>
            <span style={{ padding: '0.2rem 0.5rem', borderRadius: '4px', background: 'var(--brand-blue)', color: '#ffffff', fontSize: '0.7rem', fontWeight: 700 }}>
              GSTR-3B
            </span>
          </div>
          <div style={{ fontSize: '1.65rem', fontWeight: 800, color: 'var(--brand-blue)' }}>
            ₹ {(gstSummary?.net_gst_payable || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
            Output GST minus Available Input Tax Credit
          </div>
        </div>

      </div>

      {/* Tax Component Breakdown Matrix */}
      <div className="card glass-card" style={{ padding: '1.25rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 1rem 0', color: 'var(--text-primary)' }}>
          Statutory Tax Head Reconciliation Matrix (₹)
        </h3>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                <th style={{ padding: '0.75rem 1rem' }}>Tax Component</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Output Tax (Sales Liability)</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Input Tax Credit (Purchases/Expenses)</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Net Payable / Carry Forward</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>
                  CGST (Central GST - Kerala Intra-State)
                </td>
                <td className="mono" style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                  ₹ {(gstSummary?.output_gst.cgst || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td className="mono" style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#10b981' }}>
                  ₹ {(gstSummary?.input_gst.cgst || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td className="mono" style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: 'var(--brand-blue)' }}>
                  ₹ {Math.max(0, (gstSummary?.output_gst.cgst || 0) - (gstSummary?.input_gst.cgst || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
              </tr>

              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>
                  SGST (State GST - Kerala Intra-State)
                </td>
                <td className="mono" style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                  ₹ {(gstSummary?.output_gst.sgst || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td className="mono" style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#10b981' }}>
                  ₹ {(gstSummary?.input_gst.sgst || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td className="mono" style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: 'var(--brand-blue)' }}>
                  ₹ {Math.max(0, (gstSummary?.output_gst.sgst || 0) - (gstSummary?.input_gst.sgst || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
              </tr>

              <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>
                  IGST (Integrated GST - Inter-State Outward/Inward)
                </td>
                <td className="mono" style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                  ₹ {(gstSummary?.output_gst.igst || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td className="mono" style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#10b981' }}>
                  ₹ {(gstSummary?.input_gst.igst || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td className="mono" style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: 'var(--brand-blue)' }}>
                  ₹ {Math.max(0, (gstSummary?.output_gst.igst || 0) - (gstSummary?.input_gst.igst || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
              </tr>

              <tr style={{ background: '#f8fafc', fontWeight: 800, fontSize: '0.875rem' }}>
                <td style={{ padding: '0.85rem 1rem', color: '#0f172a' }}>
                  TOTAL STATUTORY TAX RECONCILIATION
                </td>
                <td className="mono" style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                  ₹ {(gstSummary?.output_gst.total_output || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td className="mono" style={{ padding: '0.85rem 1rem', textAlign: 'right', color: '#10b981' }}>
                  ₹ {(gstSummary?.input_gst.total_input || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td className="mono" style={{ padding: '0.85rem 1rem', textAlign: 'right', color: 'var(--brand-blue)' }}>
                  ₹ {(gstSummary?.net_gst_payable || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* GSTIN Statutory Validator Tool */}
      <div className="card glass-card" style={{ padding: '1.25rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.25rem 0', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ShieldCheck size={18} style={{ color: 'var(--brand-blue)' }} />
          <span>Vendor & Customer GSTIN Statutory Format Validator</span>
        </h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 1rem 0' }}>
          Validate 15-digit GSTIN structure before raising invoices or claiming vendor ITC credits.
        </p>

        <form onSubmit={handleValidateGSTIN} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Enter GSTIN to verify (e.g. 32AABCH1234F1Z1)..."
            value={gstinInput}
            onChange={(e) => setGstinInput(e.target.value.toUpperCase())}
            maxLength={15}
            style={{ width: '320px', fontFamily: 'monospace', fontSize: '0.8125rem' }}
          />
          <button type="submit" className="btn-primary" style={{ fontSize: '0.8125rem' }}>
            Verify Format
          </button>
        </form>

        {gstinResult && (
          <div style={{
            marginTop: '0.85rem',
            padding: '0.65rem 0.85rem',
            borderRadius: '6px',
            background: gstinResult.isValid ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            color: gstinResult.isValid ? '#065f46' : '#dc2626',
            fontSize: '0.8rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            {gstinResult.isValid ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{gstinResult.message}</span>
          </div>
        )}
      </div>

    </div>
  );
};

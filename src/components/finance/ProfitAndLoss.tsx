import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, 
  Calendar, 
  Printer
} from 'lucide-react';
import type { ProfitAndLossReport } from '../../types';
import { financeService } from '../../services/financeService';

export const ProfitAndLoss: React.FC = () => {
  const [pnl, setPnl] = useState<ProfitAndLossReport | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const loadPnL = async () => {
    try {
      const data = await financeService.getProfitAndLoss(startDate || undefined, endDate || undefined);
      setPnl(data);
    } catch (e) {
      console.error('Failed to load P&L report:', e);
    }
  };

  useEffect(() => {
    loadPnL();
    const unsub = financeService.subscribe(() => {
      loadPnL();
    });
    return unsub;
  }, [startDate, endDate]);

  const grossProfit = pnl ? pnl.total_revenue - pnl.total_purchases : 0;
  const grossMarginPct = pnl && pnl.total_revenue > 0 ? ((grossProfit / pnl.total_revenue) * 100).toFixed(1) : '0.0';
  const netMarginPct = pnl && pnl.total_revenue > 0 ? ((pnl.net_profit / pnl.total_revenue) * 100).toFixed(1) : '0.0';

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Top Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0 0 0.25rem 0', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <TrendingUp size={28} style={{ color: 'var(--brand-blue)' }} />
            <span>Profit & Loss Financial Statement</span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
            Comprehensive executive statement of gross revenue, procurement costs, operating expenditures, and net business profitability.
          </p>
        </div>

        <button
          onClick={() => window.print()}
          className="btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <Printer size={16} />
          <span>Print Financial P&L</span>
        </button>
      </div>

      {/* Date Range Ribbon */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', background: 'rgba(255, 255, 255, 0.7)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <Calendar size={14} />
          Financial Period:
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
            Reset
          </button>
        )}
      </div>

      {/* 4 Summary Highlight Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        
        <div className="card glass-card" style={{ padding: '1.15rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
            Gross Operating Revenue
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            ₹ {(pnl?.total_revenue || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Total billed client invoices
          </div>
        </div>

        <div className="card glass-card" style={{ padding: '1.15rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
            Cost of Goods & Purchases
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#dc2626' }}>
            ₹ {(pnl?.total_purchases || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Material & fabrication bills
          </div>
        </div>

        <div className="card glass-card" style={{ padding: '1.15rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
            Operating Expenses (OpEx)
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#d97706' }}>
            ₹ {(pnl?.total_expenses || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Fuel, overheads, fleet running costs
          </div>
        </div>

        <div className="card glass-card" style={{ padding: '1.15rem 1.25rem', background: (pnl?.net_profit || 0) >= 0 ? 'rgba(16, 185, 129, 0.06)' : 'rgba(239, 68, 68, 0.06)', border: `1.5px solid ${(pnl?.net_profit || 0) >= 0 ? '#10b981' : '#dc2626'}` }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: (pnl?.net_profit || 0) >= 0 ? '#047857' : '#dc2626', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
            Net Operating Profit
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: (pnl?.net_profit || 0) >= 0 ? '#047857' : '#dc2626' }}>
            ₹ {(pnl?.net_profit || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Net Margin: <strong>{netMarginPct}%</strong>
          </div>
        </div>

      </div>

      {/* Formal P&L Statement Table */}
      <div className="card glass-card" style={{ padding: '1.5rem' }}>
        <div style={{ borderBottom: '2px solid #0f172a', paddingBottom: '0.75rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
              B2P INTERNATIONAL
            </h2>
            <div style={{ fontSize: '0.8125rem', color: '#475569', fontWeight: 600 }}>
              Statement of Profit and Loss (for the selected period)
            </div>
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'right' }}>
            Currency: Indian Rupee (INR ₹)
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <tbody>
            
            {/* Section 1: Revenue */}
            <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
              <td style={{ padding: '0.75rem 1rem', color: '#0f172a' }} colSpan={2}>
                I. REVENUE FROM OPERATIONS
              </td>
              <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Amount (₹)</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '0.65rem 1.5rem', color: '#334155' }} colSpan={2}>
                Gross Sales Invoicing (Outdoor Advertising, LED Mobile Vans, Roadshows)
              </td>
              <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right', fontWeight: 600 }}>
                ₹ {(pnl?.total_revenue || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </td>
            </tr>
            <tr style={{ borderBottom: '2px solid #e2e8f0', background: 'rgba(37, 99, 235, 0.04)', fontWeight: 700 }}>
              <td style={{ padding: '0.65rem 1rem', color: 'var(--brand-blue)' }} colSpan={2}>
                TOTAL REVENUE (A)
              </td>
              <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right', color: 'var(--brand-blue)' }}>
                ₹ {(pnl?.total_revenue || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </td>
            </tr>

            {/* Spacer */}
            <tr><td colSpan={3} style={{ height: '0.75rem' }}></td></tr>

            {/* Section 2: Direct Cost / Purchases */}
            <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
              <td style={{ padding: '0.75rem 1rem', color: '#0f172a' }} colSpan={2}>
                II. DIRECT PROCUREMENT & COST OF GOODS
              </td>
              <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Amount (₹)</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '0.65rem 1.5rem', color: '#334155' }} colSpan={2}>
                Vendor Purchases (LED Panels, Metal Fabrication, Flex Banners, Sound Systems)
              </td>
              <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right', fontWeight: 600, color: '#dc2626' }}>
                ₹ {(pnl?.total_purchases || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </td>
            </tr>
            <tr style={{ borderBottom: '2px solid #e2e8f0', background: 'rgba(239, 68, 68, 0.04)', fontWeight: 700 }}>
              <td style={{ padding: '0.65rem 1rem', color: '#dc2626' }} colSpan={2}>
                TOTAL DIRECT COSTS (B)
              </td>
              <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right', color: '#dc2626' }}>
                ₹ {(pnl?.total_purchases || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </td>
            </tr>

            {/* Gross Profit Ribbon */}
            <tr style={{ background: '#f1f5f9', fontWeight: 800 }}>
              <td style={{ padding: '0.75rem 1rem', color: '#0f172a' }} colSpan={2}>
                III. GROSS OPERATING MARGIN (A - B) &bull; {grossMarginPct}% Margin
              </td>
              <td className="mono" style={{ padding: '0.75rem 1rem', textAlign: 'right', color: '#0f172a' }}>
                ₹ {grossProfit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </td>
            </tr>

            {/* Spacer */}
            <tr><td colSpan={3} style={{ height: '0.75rem' }}></td></tr>

            {/* Section 3: Operating Expenses */}
            <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
              <td style={{ padding: '0.75rem 1rem', color: '#0f172a' }} colSpan={2}>
                IV. OPERATING EXPENDITURES (OpEx)
              </td>
              <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Amount (₹)</td>
            </tr>
            {pnl && Object.entries(pnl.expense_breakdown).length > 0 ? (
              Object.entries(pnl.expense_breakdown).map(([category, amount]) => (
                <tr key={category} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.5rem 1.5rem', color: '#475569' }} colSpan={2}>
                    {category} Expenses
                  </td>
                  <td className="mono" style={{ padding: '0.5rem 1rem', textAlign: 'right', color: '#334155' }}>
                    ₹ {amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td style={{ padding: '0.5rem 1.5rem', color: '#94a3b8' }} colSpan={3}>
                  No operating expenses logged in period.
                </td>
              </tr>
            )}
            <tr style={{ borderBottom: '2px solid #e2e8f0', background: 'rgba(217, 119, 6, 0.04)', fontWeight: 700 }}>
              <td style={{ padding: '0.65rem 1rem', color: '#d97706' }} colSpan={2}>
                TOTAL OPERATING EXPENSES (C)
              </td>
              <td className="mono" style={{ padding: '0.65rem 1rem', textAlign: 'right', color: '#d97706' }}>
                ₹ {(pnl?.total_expenses || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </td>
            </tr>

            {/* Spacer */}
            <tr><td colSpan={3} style={{ height: '0.75rem' }}></td></tr>

            {/* Section 4: Net Profit */}
            <tr style={{ background: (pnl?.net_profit || 0) >= 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)', borderTop: '2px solid #0f172a', borderBottom: '2px solid #0f172a', fontWeight: 800, fontSize: '1rem' }}>
              <td style={{ padding: '1rem', color: (pnl?.net_profit || 0) >= 0 ? '#065f46' : '#dc2626' }} colSpan={2}>
                NET OPERATING PROFIT / (LOSS) (A - B - C)
              </td>
              <td className="mono" style={{ padding: '1rem', textAlign: 'right', color: (pnl?.net_profit || 0) >= 0 ? '#065f46' : '#dc2626' }}>
                ₹ {(pnl?.net_profit || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </td>
            </tr>

          </tbody>
        </table>
      </div>

    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { X, Check, ShoppingCart, Plus, Trash2, AlertCircle } from 'lucide-react';
import type { Purchase, PurchaseItem, Supplier, AccountHead } from '../../types';
import { financeService } from '../../services/financeService';
import { taxEngine } from '../../services/taxEngine';

interface PurchaseModalProps {
  initialPurchase?: Purchase | null;
  userEmail?: string;
  onClose: () => void;
  onSaved: (purchase: Purchase) => void;
}

export const PurchaseModal: React.FC<PurchaseModalProps> = ({
  initialPurchase,
  userEmail = 'accounts@b2p.com',
  onClose,
  onSaved
}) => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accounts, setAccounts] = useState<AccountHead[]>([]);
  const [supplierId, setSupplierId] = useState(initialPurchase?.supplier_id || '');
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState(initialPurchase?.supplier_invoice_number || '');
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState(initialPurchase?.supplier_invoice_date || initialPurchase?.purchase_date || new Date().toISOString().split('T')[0]);
  const [purchaseDate, setPurchaseDate] = useState(initialPurchase?.purchase_date || new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState(initialPurchase?.due_date || new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0]);
  const [paymentTerms, setPaymentTerms] = useState(initialPurchase?.payment_terms || '30 Days Net');
  const [notes, setNotes] = useState(initialPurchase?.notes || '');
  const [error, setError] = useState('');

  // Line items state
  const [items, setItems] = useState<PurchaseItem[]>(
    initialPurchase?.items?.length ? initialPurchase.items : [
      {
        id: 'pi-new-1',
        account_id: 'ah-5001',
        account_code: '5001',
        account_name: 'Fleet Fuel & Diesel Expenses',
        description: '',
        hsn_sac: '998361',
        quantity: 1,
        unit: 'units',
        rate: 0,
        discount: 0,
        taxable_amount: 0,
        gst_percentage: 18,
        cgst: 0,
        sgst: 0,
        igst: 0,
        cess: 0,
        total_amount: 0
      }
    ]
  );

  useEffect(() => {
    const suppList = financeService.getSuppliers();
    setSuppliers(suppList);
    if (!supplierId && suppList.length > 0) {
      setSupplierId(suppList[0].id);
      if (suppList[0].payment_terms) {
        setPaymentTerms(suppList[0].payment_terms);
      }
    }

    const heads = financeService.getAccountHeads(true).filter((a: AccountHead) => 
      a.type === 'expense' || a.type === 'asset'
    );
    setAccounts(heads);
  }, []);

  const selectedSupplier = suppliers.find(s => s.id === supplierId);
  const pos = selectedSupplier?.place_of_supply || selectedSupplier?.state || 'Kerala';

  // Recalculate item using authoritative taxEngine
  const recalculateItem = (item: PurchaseItem, newPos: string): PurchaseItem => {
    const qty = Number(item.quantity) || 1;
    const rate = Number(item.rate) || 0;
    const discount = Number(item.discount) || 0;
    const taxable = Math.max(0, (qty * rate) - discount);
    const gstRate = Number(item.gst_percentage) || 0;

    const taxRes = taxEngine.calculateTax({
      taxableValue: taxable,
      gstRate,
      placeOfSupply: newPos,
      customerSupplierGstin: selectedSupplier?.gstin
    });

    return {
      ...item,
      taxable_amount: taxRes.taxable_value,
      cgst: taxRes.cgst_amount,
      sgst: taxRes.sgst_amount,
      igst: taxRes.igst_amount,
      cess: taxRes.cess_amount,
      total_amount: taxRes.total_amount
    };
  };

  const handleSupplierChange = (newSuppId: string) => {
    setSupplierId(newSuppId);
    const supp = suppliers.find(s => s.id === newSuppId);
    if (supp) {
      if (supp.payment_terms) setPaymentTerms(supp.payment_terms);
      const newPos = supp.place_of_supply || supp.state || 'Kerala';
      const updated = items.map(it => recalculateItem(it, newPos));
      setItems(updated);
    }
  };

  const handleItemChange = (index: number, field: keyof PurchaseItem, val: any) => {
    const updated = [...items];
    let it = { ...updated[index], [field]: val };

    if (field === 'account_id') {
      const acct = accounts.find(a => a.id === val);
      if (acct) {
        it.account_code = acct.code;
        it.account_name = acct.name;
      }
    }

    it = recalculateItem(it, pos);
    updated[index] = it;
    setItems(updated);
  };

  const addItem = () => {
    const defaultHead = accounts[0] || { id: 'ah-5001', code: '5001', name: 'Fleet Fuel & Diesel Expenses' };
    const newItem: PurchaseItem = recalculateItem({
      id: `pi-new-${Date.now()}`,
      account_id: defaultHead.id,
      account_code: defaultHead.code,
      account_name: defaultHead.name,
      description: '',
      hsn_sac: '998361',
      quantity: 1,
      unit: 'units',
      rate: 0,
      discount: 0,
      taxable_amount: 0,
      gst_percentage: 18,
      cgst: 0,
      sgst: 0,
      igst: 0,
      cess: 0,
      total_amount: 0
    }, pos);

    setItems([...items, newItem]);
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, idx) => idx !== index));
  };

  const totalTaxable = items.reduce((sum, i) => sum + (Number(i.taxable_amount) || 0), 0);
  const totalCgst = items.reduce((sum, i) => sum + (Number(i.cgst) || 0), 0);
  const totalSgst = items.reduce((sum, i) => sum + (Number(i.sgst) || 0), 0);
  const totalIgst = items.reduce((sum, i) => sum + (Number(i.igst) || 0), 0);
  const totalTax = totalCgst + totalSgst + totalIgst;
  const grandTotal = items.reduce((sum, i) => sum + (Number(i.total_amount) || 0), 0);

  const handleSubmit = async (action: 'draft' | 'post') => {
    setError('');

    if (!supplierId) {
      setError('Please select a supplier.');
      return;
    }
    if (!supplierInvoiceNumber.trim()) {
      setError('Supplier invoice/bill number is required.');
      return;
    }
    if (items.some(i => !i.description.trim() || i.rate <= 0)) {
      setError('Please provide valid descriptions and rates for all purchase items.');
      return;
    }

    try {
      const saved = await financeService.savePurchase({
        id: initialPurchase?.id,
        supplier_id: supplierId,
        supplier_name: selectedSupplier?.name || 'Vendor',
        supplier_company: selectedSupplier?.legal_name || selectedSupplier?.company_name,
        supplier_gstin: selectedSupplier?.gstin,
        supplier_invoice_number: supplierInvoiceNumber.trim(),
        supplier_invoice_date: supplierInvoiceDate,
        purchase_date: purchaseDate,
        due_date: dueDate,
        place_of_supply: pos,
        payment_terms: paymentTerms,
        items,
        taxable_value: totalTaxable,
        total_cgst: totalCgst,
        total_sgst: totalSgst,
        total_igst: totalIgst,
        total_gst: totalTax,
        total_amount: grandTotal,
        notes: notes.trim() || undefined
      }, userEmail, action);

      onSaved(saved);
    } catch (err: any) {
      setError(err.message || 'Failed to save purchase bill.');
    }
  };

  return (
    <div className="modal-overlay">
      <div 
        className="modal-content"
        style={{
          width: '100%',
          maxWidth: '880px',
          padding: 0,
          background: '#ffffff',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#ffffff'
        }}>
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShoppingCart size={20} style={{ color: 'var(--brand-blue)' }} />
              <span>{initialPurchase ? `Edit Purchase Bill #${initialPurchase.purchase_number}` : 'Record New Purchase Bill'}</span>
            </h2>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
              Record vendor bills with chart of accounts expense heads, GST input tax credits, and double-entry general ledger posting.
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '0.4rem' }}>
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', maxHeight: '75vh', overflowY: 'auto', background: '#f8fafc' }}>
          
          {error && (
            <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', color: '#dc2626', fontSize: '0.8125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {/* Supplier & Bill Header Details */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem', background: '#ffffff', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Supplier / Vendor *
              </label>
              <select
                value={supplierId}
                onChange={(e) => handleSupplierChange(e.target.value)}
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              >
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.gstin ? `(${s.gstin})` : '(Unregistered)'} - {s.state}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Vendor Bill / Invoice # *
              </label>
              <input
                type="text"
                value={supplierInvoiceNumber}
                onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                placeholder="e.g. INV-9842"
                className="input-field mono"
                style={{ width: '100%', fontSize: '0.8125rem' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Supplier Invoice Date *
              </label>
              <input
                type="date"
                value={supplierInvoiceDate}
                onChange={(e) => setSupplierInvoiceDate(e.target.value)}
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Bill Entry Date *
              </label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
                Payment Due Date
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              />
            </div>
          </div>

          {/* Line Items Table */}
          <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1e293b' }}>Purchase Bill Line Items</span>
              <button
                type="button"
                onClick={addItem}
                className="btn-secondary"
                style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
              >
                <Plus size={14} />
                <span>Add Item</span>
              </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', textAlign: 'left' }}>
                    <th style={{ padding: '0.5rem 0.75rem', minWidth: '150px' }}>Expense / Asset Head</th>
                    <th style={{ padding: '0.5rem 0.75rem', minWidth: '180px' }}>Description</th>
                    <th style={{ padding: '0.5rem 0.5rem', width: '70px' }}>Qty</th>
                    <th style={{ padding: '0.5rem 0.5rem', width: '90px' }}>Rate (₹)</th>
                    <th style={{ padding: '0.5rem 0.5rem', width: '80px' }}>Taxable (₹)</th>
                    <th style={{ padding: '0.5rem 0.5rem', width: '85px' }}>GST %</th>
                    <th style={{ padding: '0.5rem 0.5rem', width: '90px', textAlign: 'right' }}>Total (₹)</th>
                    <th style={{ padding: '0.5rem 0.5rem', width: '40px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <select
                          value={item.account_id}
                          onChange={(e) => handleItemChange(idx, 'account_id', e.target.value)}
                          className="input-field"
                          style={{ width: '100%', fontSize: '0.72rem', padding: '0.3rem 0.4rem' }}
                        >
                          {accounts.map(a => (
                            <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => handleItemChange(idx, 'description', e.target.value)}
                          placeholder="e.g. Diesel fuel for LED roadshow van"
                          className="input-field"
                          style={{ width: '100%', fontSize: '0.75rem', padding: '0.3rem 0.4rem' }}
                        />
                      </td>
                      <td style={{ padding: '0.5rem 0.5rem' }}>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(idx, 'quantity', parseFloat(e.target.value) || 1)}
                          className="input-field mono"
                          style={{ width: '100%', fontSize: '0.75rem', padding: '0.3rem 0.4rem' }}
                        />
                      </td>
                      <td style={{ padding: '0.5rem 0.5rem' }}>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.rate}
                          onChange={(e) => handleItemChange(idx, 'rate', parseFloat(e.target.value) || 0)}
                          className="input-field mono"
                          style={{ width: '100%', fontSize: '0.75rem', padding: '0.3rem 0.4rem' }}
                        />
                      </td>
                      <td className="mono" style={{ padding: '0.5rem 0.5rem', fontWeight: 600 }}>
                        ₹ {item.taxable_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '0.5rem 0.5rem' }}>
                        <select
                          value={item.gst_percentage}
                          onChange={(e) => handleItemChange(idx, 'gst_percentage', parseInt(e.target.value) || 0)}
                          className="input-field"
                          style={{ width: '100%', fontSize: '0.72rem', padding: '0.3rem 0.4rem' }}
                        >
                          <option value="0">0% (Nil)</option>
                          <option value="5">5%</option>
                          <option value="12">12%</option>
                          <option value="18">18%</option>
                          <option value="28">28%</option>
                        </select>
                      </td>
                      <td className="mono" style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontWeight: 700, color: 'var(--brand-blue)' }}>
                        ₹ {item.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '0.5rem 0.5rem', textAlign: 'center' }}>
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            className="btn-ghost"
                            style={{ padding: '0.2rem', color: '#dc2626' }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tax Breakdown & Grand Total */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: '320px', background: '#ffffff', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.78rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Total Taxable Value:</span>
                <strong className="mono">₹ {totalTaxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
              </div>
              {totalCgst > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Input CGST (Credit):</span>
                  <strong className="mono" style={{ color: '#16a34a' }}>₹ {totalCgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
                </div>
              )}
              {totalSgst > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Input SGST (Credit):</span>
                  <strong className="mono" style={{ color: '#16a34a' }}>₹ {totalSgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
                </div>
              )}
              {totalIgst > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Input IGST (Credit):</span>
                  <strong className="mono" style={{ color: '#16a34a' }}>₹ {totalIgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', paddingTop: '0.4rem', marginTop: '0.2rem' }}>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>Total Invoice Amount:</span>
                <strong className="mono" style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--brand-blue)' }}>
                  ₹ {grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </strong>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#475569', marginBottom: '0.35rem' }}>
              Notes & Delivery References
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Roadshow event equipment hire invoice verified by operations"
              className="input-field"
              style={{ width: '100%', fontSize: '0.8125rem' }}
            />
          </div>

        </div>

        {/* Modal Actions */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#ffffff'
        }}>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
            style={{ padding: '0.45rem 1rem', fontSize: '0.8125rem' }}
          >
            Cancel
          </button>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => handleSubmit('draft')}
              className="btn-secondary"
              style={{ padding: '0.45rem 1.15rem', fontSize: '0.8125rem' }}
            >
              Save Draft
            </button>

            <button
              type="button"
              onClick={() => handleSubmit('post')}
              className="btn-primary"
              style={{ padding: '0.45rem 1.35rem', fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Check size={16} />
              <span>Post Bill & General Ledger</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

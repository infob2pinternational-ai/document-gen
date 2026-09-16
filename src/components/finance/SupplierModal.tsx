import React, { useState } from 'react';
import { X, Check, Truck, AlertCircle } from 'lucide-react';
import type { Supplier } from '../../types';
import { financeService } from '../../services/financeService';
import { taxEngine, INDIAN_GST_STATES } from '../../services/taxEngine';

interface SupplierModalProps {
  initialSupplier?: Supplier | null;
  onClose: () => void;
  onSaved: (supplier: Supplier) => void;
}

export const SupplierModal: React.FC<SupplierModalProps> = ({
  initialSupplier,
  onClose,
  onSaved
}) => {
  const [name, setName] = useState(initialSupplier?.name || '');
  const [legalName, setLegalName] = useState(initialSupplier?.legal_name || initialSupplier?.company_name || '');
  const [phone, setPhone] = useState(initialSupplier?.phone || '');
  const [email, setEmail] = useState(initialSupplier?.email || '');
  const [address, setAddress] = useState(initialSupplier?.address || initialSupplier?.billing_address || '');
  const [gstin, setGstin] = useState(initialSupplier?.gstin || '');
  const [stateCode, setStateCode] = useState(initialSupplier?.state_code || '32');
  const [paymentTerms, setPaymentTerms] = useState(initialSupplier?.payment_terms || '30 Days Net');
  const [openingBalance, setOpeningBalance] = useState<number>(initialSupplier?.opening_balance || 0);
  const [notes, setNotes] = useState(initialSupplier?.notes || '');
  const [error, setError] = useState('');
  const [gstinValidationMsg, setGstinValidationMsg] = useState<{ isValid: boolean; message: string } | null>(null);

  const handleGstinChange = (val: string) => {
    const clean = val.trim().toUpperCase();
    setGstin(clean);
    if (!clean) {
      setGstinValidationMsg(null);
      return;
    }
    const res = taxEngine.validateGSTIN(clean);
    if (res.isValid) {
      setGstinValidationMsg({
        isValid: true,
        message: `Valid format. State: ${res.stateName} (${res.stateCode}), PAN: ${res.pan}`
      });
      if (res.stateCode) {
        setStateCode(res.stateCode);
      }
    } else {
      setGstinValidationMsg({
        isValid: false,
        message: res.error || 'Invalid 15-character statutory GSTIN checksum format.'
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Supplier / Vendor name is required.');
      return;
    }

    const stateName = INDIAN_GST_STATES[stateCode] || 'Kerala';

    try {
      const saved = await financeService.saveSupplier({
        id: initialSupplier?.id,
        name: name.trim(),
        legal_name: legalName.trim() || undefined,
        company_name: legalName.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        billing_address: address.trim() || undefined,
        gstin: gstin.trim().toUpperCase() || undefined,
        state: stateName,
        state_code: stateCode,
        place_of_supply: stateName,
        payment_terms: paymentTerms,
        opening_balance: Number(openingBalance) || 0,
        notes: notes.trim() || undefined
      });

      onSaved(saved);
    } catch (err: any) {
      setError(err.message || 'Failed to save supplier.');
    }
  };

  return (
    <div className="modal-overlay">
      <div 
        className="modal-content"
        style={{
          width: '100%',
          maxWidth: '580px',
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
              <Truck size={20} style={{ color: 'var(--brand-blue)' }} />
              <span>{initialSupplier ? 'Edit Vendor / Supplier' : 'Register New Vendor / Supplier'}</span>
            </h2>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
              Add equipment vendors, flex printers, fuel partners, and fabrication suppliers.
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '0.4rem' }}>
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', background: '#f8fafc' }}>
          
          {error && (
            <div style={{ padding: '0.65rem 0.85rem', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', color: '#dc2626', fontSize: '0.8rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Supplier Name & Trade Legal Name */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Vendor / Brand Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. HighTech LED Displays"
                required
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Legal Registered Entity Name
              </label>
              <input
                type="text"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="e.g. HighTech Electronics Pvt Ltd"
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              />
            </div>
          </div>

          {/* GSTIN & State */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Statutory GSTIN (Optional)
              </label>
              <input
                type="text"
                value={gstin}
                onChange={(e) => handleGstinChange(e.target.value)}
                placeholder="e.g. 32AABCB1234A1Z5"
                className="input-field mono"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              />
              {gstinValidationMsg && (
                <div style={{ fontSize: '0.7rem', marginTop: '0.25rem', color: gstinValidationMsg.isValid ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                  {gstinValidationMsg.message}
                </div>
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                State / Jurisdiction
              </label>
              <select
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              >
                {Object.entries(INDIAN_GST_STATES).map(([code, stName]) => (
                  <option key={code} value={code}>{code} - {stName}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Phone & Email */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Phone Number
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98470 00000"
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="billing@vendor.com"
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              />
            </div>
          </div>

          {/* Payment Terms & Opening Balance */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Default Payment Terms
              </label>
              <select
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                className="input-field"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              >
                <option value="Immediate">Immediate / Due on Receipt</option>
                <option value="7 Days Net">7 Days Net</option>
                <option value="15 Days Net">15 Days Net</option>
                <option value="30 Days Net">30 Days Net</option>
                <option value="45 Days Net">45 Days Net</option>
                <option value="60 Days Net">60 Days Net</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
                Opening Balance Payable (₹)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="input-field mono"
                style={{ width: '100%', fontSize: '0.8125rem' }}
              />
            </div>
          </div>

          {/* Billing Address */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
              Billing / Workshop Address
            </label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Building No., Industrial Estate, City, PIN"
              rows={2}
              className="input-field"
              style={{ width: '100%', fontSize: '0.8125rem', resize: 'vertical' }}
            />
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#475569', marginBottom: '0.35rem' }}>
              Notes & Contract References
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Primary LED display panel supplier with AMC contract"
              className="input-field"
              style={{ width: '100%', fontSize: '0.8125rem' }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              style={{ padding: '0.45rem 1rem', fontSize: '0.8125rem' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{ padding: '0.45rem 1.25rem', fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Check size={16} />
              <span>{initialSupplier ? 'Update Supplier' : 'Save Supplier'}</span>
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};

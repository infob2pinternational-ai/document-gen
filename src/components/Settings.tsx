import React, { useState, useEffect } from 'react';
import type { CompanyProfile } from '../types';
import { dbService, SQL_SCHEMA, isSupabaseConfigured } from '../services/db';
import { 
  Building, 
  Upload, 
  Check, 
  Trash2, 
  AlertCircle, 
  Database,
  Info
} from 'lucide-react';

interface SettingsProps {
  role: string;
  profiles: CompanyProfile[];
  activeProfile: CompanyProfile | null;
  onRefreshProfiles: (selectNewId?: string) => void;
  user: any;
}

export const Settings: React.FC<SettingsProps> = ({
  role,
  profiles,
  activeProfile,
  onRefreshProfiles,
  user
}) => {
  // Tabs: 'profile', 'sheets', 'database'
  const [activeTab, setActiveTab] = useState<'profile' | 'sheets' | 'database'>('profile');
  
  // Active Profile Form States
  const [name, setName] = useState('');
  const [logo, setLogo] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [website, setWebsite] = useState('');
  const [currency, setCurrency] = useState('INR');

  // Bank
  const [bankName, setBankName] = useState('');
  const [bankAccountNo, setBankAccountNo] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [bankHolder, setBankHolder] = useState('');
  const [bankBranch, setBankBranch] = useState('');

  // Branding
  const [defaultTerms, setDefaultTerms] = useState('');
  const [letterheadHeader, setLetterheadHeader] = useState('');
  const [letterheadFooter, setLetterheadFooter] = useState('');
  const [seal, setSeal] = useState('');
  const [stamp, setStamp] = useState('');

  // Branding Toggles
  const [showLetterhead, setShowLetterhead] = useState(true);
  const [watermarkText, setWatermarkText] = useState('');
  const [showSignature, setShowSignature] = useState(false);
  const [signatureText, setSignatureText] = useState('');
  const [showBankDetails, setShowBankDetails] = useState(true);

  // Column Headings
  const [colDesc, setColDesc] = useState('Description');
  const [colQty, setColQty] = useState('Quantity');
  const [colUnit, setColUnit] = useState('Unit');
  const [colRate, setColRate] = useState('Rate');
  const [colAmt, setColAmt] = useState('Amount');

  // Sequences
  const [invoicePrefix, setInvoicePrefix] = useState('INV/');
  const [invoiceStart, setInvoiceStart] = useState<number>(1001);
  const [proformaPrefix, setProformaPrefix] = useState('PI/');
  const [proformaStart, setProformaStart] = useState<number>(1001);
  const [quotationPrefix, setQuotationPrefix] = useState('QTN/');
  const [quotationStart, setQuotationStart] = useState<number>(1001);
  const [workOrderPrefix, setWorkOrderPrefix] = useState('WO/');
  const [workOrderStart, setWorkOrderStart] = useState<number>(1001);

  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [googleSheetsUrl, setGoogleSheetsUrl] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);

  // Connection active state
  const isCloudConnected = isSupabaseConfigured() && !!user;

  // Load active profile data
  useEffect(() => {
    if (activeProfile) {
      setName(activeProfile.name);
      setLogo(activeProfile.logo_url || '');
      setGstin(activeProfile.gstin || '');
      setPan(activeProfile.pan || '');
      setEmail(activeProfile.email || '');
      setPhone(activeProfile.phone || '');
      setAddress(activeProfile.address || '');
      setWebsite(activeProfile.website || '');
      setCurrency(activeProfile.currency);

      setBankName(activeProfile.bank_name || '');
      setBankAccountNo(activeProfile.bank_account_no || '');
      setBankIfsc(activeProfile.bank_ifsc || '');
      setBankHolder(activeProfile.bank_holder || '');
      setBankBranch(activeProfile.bank_branch || '');

      setDefaultTerms(activeProfile.default_terms || '');
      setLetterheadHeader(activeProfile.letterhead_header_url || '');
      setLetterheadFooter(activeProfile.letterhead_footer_url || '');
      setSeal(activeProfile.seal_url || '');
      setStamp(activeProfile.stamp_url || '');

      setShowLetterhead(activeProfile.show_letterhead !== false);
      setWatermarkText(activeProfile.watermark_text || '');
      setShowSignature(activeProfile.show_signature === true);
      setSignatureText(activeProfile.signature_text || '');
      setShowBankDetails(activeProfile.show_bank_details !== false);

      setColDesc(activeProfile.col_name_description || 'Description');
      setColQty(activeProfile.col_name_quantity || 'Quantity');
      setColUnit(activeProfile.col_name_unit || 'Unit');
      setColRate(activeProfile.col_name_rate || 'Rate');
      setColAmt(activeProfile.col_name_amount || 'Amount');

      setInvoicePrefix(activeProfile.invoice_prefix || 'INV/');
      setInvoiceStart(activeProfile.invoice_start_number || 1001);
      setProformaPrefix(activeProfile.proforma_prefix || 'PI/');
      setProformaStart(activeProfile.proforma_start_number || 1001);
      setQuotationPrefix(activeProfile.quotation_prefix || 'QTN/');
      setQuotationStart(activeProfile.quotation_start_number || 1001);
      setWorkOrderPrefix(activeProfile.work_order_prefix || 'WO/');
      setWorkOrderStart(activeProfile.work_order_start_number || 1001);
      setGoogleSheetsUrl(activeProfile.google_sheets_url || '');
    }
  }, [activeProfile]);

  // If cloud connection is active, ensure we don't show the database tab
  useEffect(() => {
    if (isCloudConnected && activeTab === 'database') {
      setActiveTab('profile');
    }
  }, [isCloudConnected, activeTab]);

  // Convert files to Base64 helper
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, setter: (val: string) => void) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setter(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProfile) return;

    setSaving(true);
    try {
      const updated: CompanyProfile = {
        ...activeProfile,
        name,
        logo_url: logo || undefined,
        gstin: gstin || undefined,
        pan: pan || undefined,
        email: email || undefined,
        phone: phone || undefined,
        address: address || undefined,
        website: website || undefined,
        currency,
        bank_name: bankName || undefined,
        bank_account_no: bankAccountNo || undefined,
        bank_ifsc: bankIfsc || undefined,
        bank_holder: bankHolder || undefined,
        bank_branch: bankBranch || undefined,
        default_terms: defaultTerms || undefined,
        letterhead_header_url: letterheadHeader || undefined,
        letterhead_footer_url: letterheadFooter || undefined,
        seal_url: seal || undefined,
        stamp_url: stamp || undefined,
        show_letterhead: showLetterhead,
        watermark_text: watermarkText || undefined,
        show_signature: showSignature,
        signature_text: signatureText || undefined,
        show_bank_details: showBankDetails,
        google_sheets_url: googleSheetsUrl || undefined,
        
        col_name_description: colDesc,
        col_name_quantity: colQty,
        col_name_unit: colUnit,
        col_name_rate: colRate,
        col_name_amount: colAmt,

        invoice_prefix: invoicePrefix,
        invoice_start_number: Number(invoiceStart),
        proforma_prefix: proformaPrefix,
        proforma_start_number: Number(proformaStart),
        quotation_prefix: quotationPrefix,
        quotation_start_number: Number(quotationStart),
        work_order_prefix: workOrderPrefix,
        work_order_start_number: Number(workOrderStart)
      };

      await dbService.saveProfile(updated);
      onRefreshProfiles(activeProfile.id);
      alert('Company Profile saved successfully!');
    } catch (err) {
      console.error('Error saving profile:', err);
      alert('Failed to save profile details.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProfile = async () => {
    if (!activeProfile) return;
    if (profiles.length <= 1) {
      alert('You must have at least one active profile.');
      return;
    }

    if (window.confirm(`Are you sure you want to delete profile "${activeProfile.name}"? This deletes all associated documents and customers.`)) {
      try {
        await dbService.deleteProfile(activeProfile.id);
        onRefreshProfiles();
      } catch (err) {
        console.error('Error deleting profile:', err);
        alert('Failed to delete profile.');
      }
    }
  };

  const copySchemaToClipboard = () => {
    navigator.clipboard.writeText(SQL_SCHEMA);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTestConnection = async () => {
    if (!googleSheetsUrl) return;
    setTestingConnection(true);
    try {
      const testData = {
        company_name: activeProfile?.name || 'Test Company',
        document_number: 'TEST-1001',
        document_type: 'invoice',
        customer_name: 'John Doe Test Customer',
        customer_gstin: '07AAAAA1111A1Z1',
        issue_date: new Date().toISOString().split('T')[0],
        due_date: new Date().toISOString().split('T')[0],
        subtotal: 1000,
        tax_total: 180,
        discount_total: 0,
        total: 1180,
        status: 'paid',
        items: [
          { qty: 1, unit: 'nos', description: 'Test Consulting Services', rate: 1000 }
        ]
      };

      await fetch(googleSheetsUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(testData)
      });

      alert('Test request dispatched successfully! Please check your Google Sheet to verify if a new row was added.');
    } catch (err: any) {
      console.error('Error testing webhook connection:', err);
      alert('Failed to send test request: ' + err.message);
    } finally {
      setTestingConnection(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.25rem' }}>System Settings</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Manage multiple company profiles, templates, sequences, and configurations.
          </p>
        </div>
      </div>

      {/* Navigation tabs */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-color)',
        gap: '1rem',
        marginBottom: '0.5rem'
      }}>
        <button
          onClick={() => setActiveTab('profile')}
          style={{
            padding: '0.75rem 1rem',
            border: 'none',
            background: 'none',
            color: activeTab === 'profile' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            borderBottom: activeTab === 'profile' ? '2px solid var(--accent-primary)' : 'none',
            fontWeight: 600,
            borderRadius: 0,
            cursor: 'pointer'
          }}
        >
          Company & Branding
        </button>

        <button
          onClick={() => setActiveTab('sheets')}
          style={{
            padding: '0.75rem 1rem',
            border: 'none',
            background: 'none',
            color: activeTab === 'sheets' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            borderBottom: activeTab === 'sheets' ? '2px solid var(--accent-primary)' : 'none',
            fontWeight: 600,
            borderRadius: 0,
            cursor: 'pointer'
          }}
        >
          Google Sheets Auto-Save
        </button>

        {!isCloudConnected && (
          <button
            onClick={() => setActiveTab('database')}
            style={{
              padding: '0.75rem 1rem',
              border: 'none',
              background: 'none',
              color: activeTab === 'database' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              borderBottom: activeTab === 'database' ? '2px solid var(--accent-primary)' : 'none',
              fontWeight: 600,
              borderRadius: 0,
              cursor: 'pointer'
            }}
          >
            Cloud Setup (SQL)
          </button>
        )}
      </div>

      {!activeProfile ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <AlertCircle size={48} style={{ color: 'var(--accent-warning)', margin: '0 auto 1rem auto' }} />
          <h3>No Company Profiles</h3>
          <p style={{ color: 'var(--text-secondary)' }}>You must create a company profile to configure parameters.</p>
        </div>
      ) : (
        <>
          {/* Read-only warning banner */}
          {role !== 'admin' && (activeTab === 'profile' || activeTab === 'sheets') && (
            <div style={{
              padding: '1rem',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid var(--accent-danger)',
              color: 'var(--accent-danger)',
              fontSize: '0.875rem',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem'
            }}>
              <AlertCircle size={18} />
              <span><strong>Read-Only Access:</strong> You are logged in as a Standard User. Only Administrators can modify company profiles, bank details, templates, or webhook URLs.</span>
            </div>
          )}

          {activeTab === 'profile' && (
            <fieldset disabled={role !== 'admin'} style={{ border: 'none', padding: 0, margin: 0, display: 'contents' }}>
              <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              
              {/* Profile details */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Building size={18} />
                    <span>Company Details</span>
                  </h3>
                  <button
                    type="button"
                    onClick={handleDeleteProfile}
                    className="btn-secondary"
                    style={{ color: 'var(--accent-danger)', borderColor: 'rgba(239,68,68,0.2)' }}
                  >
                    <Trash2 size={14} />
                    <span>Delete Profile</span>
                  </button>
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Company Name *</label>
                    <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Default Currency</label>
                    <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      <option value="INR">INR (₹) - Indian Rupee</option>
                      <option value="USD">USD ($) - US Dollar</option>
                    </select>
                  </div>
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">GSTIN (Optional)</label>
                    <input type="text" placeholder="e.g. 07AAAAA1111A1Z1" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">PAN Card Number (Optional)</label>
                    <input type="text" placeholder="e.g. ABCDE1234F" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} />
                  </div>
                </div>

                <div className="grid-3">
                  <div className="form-group">
                    <label className="form-label">Contact Email</label>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Contact Phone</label>
                    <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Company Website</label>
                    <input type="url" placeholder="https://mycompany.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Registered Office Address</label>
                  <textarea rows={3} value={address} onChange={(e) => setAddress(e.target.value)} />
                </div>
              </div>

              {/* Bank accounts */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <h3 style={{ fontSize: '1.1rem' }}>Bank Accounts (Payment Collection)</h3>
                
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Bank Name</label>
                    <input type="text" placeholder="HDFC Bank" value={bankName} onChange={(e) => setBankName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Account Holder Name</label>
                    <input type="text" placeholder="Authorized Company Name" value={bankHolder} onChange={(e) => setBankHolder(e.target.value)} />
                  </div>
                </div>

                <div className="grid-3">
                  <div className="form-group">
                    <label className="form-label">Bank Account Number</label>
                    <input type="text" placeholder="Account Number" value={bankAccountNo} onChange={(e) => setBankAccountNo(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">IFSC Code</label>
                    <input type="text" placeholder="IFSC Code" value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value.toUpperCase())} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Branch Name</label>
                    <input type="text" placeholder="e.g. Connaught Place" value={bankBranch} onChange={(e) => setBankBranch(e.target.value)} />
                  </div>
                </div>
              </div>

              {/* Branding and letterheads */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <h3 style={{ fontSize: '1.1rem' }}>Branding & Print Configuration</h3>
                
                <div className="grid-3">
                  {/* Logo Upload */}
                  <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label className="form-label">Company Logo</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      {logo && <img src={logo} alt="Logo" style={{ width: '40px', height: '40px', objectFit: 'contain', border: '1px solid var(--border-color)', borderRadius: '4px' }} />}
                      <label className="btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                        <Upload size={12} />
                        <span>Upload</span>
                        <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, setLogo)} style={{ display: 'none' }} />
                      </label>
                    </div>
                  </div>

                  {/* Letterhead Header Upload */}
                  <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label className="form-label">Letterhead Header</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      {letterheadHeader && <div style={{ fontSize: '0.7rem', color: 'var(--accent-success)', fontWeight: 600 }}>Uploaded</div>}
                      <label className="btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                        <Upload size={12} />
                        <span>Upload</span>
                        <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, setLetterheadHeader)} style={{ display: 'none' }} />
                      </label>
                    </div>
                  </div>

                  {/* Letterhead Footer Upload */}
                  <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label className="form-label">Letterhead Footer</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      {letterheadFooter && <div style={{ fontSize: '0.7rem', color: 'var(--accent-success)', fontWeight: 600 }}>Uploaded</div>}
                      <label className="btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                        <Upload size={12} />
                        <span>Upload</span>
                        <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, setLetterheadFooter)} style={{ display: 'none' }} />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="grid-2">
                  {/* Seal Upload */}
                  <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label className="form-label">Company Seal</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      {seal && <img src={seal} alt="Seal" style={{ width: '40px', height: '40px', objectFit: 'contain' }} />}
                      <label className="btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                        <Upload size={12} />
                        <span>Upload</span>
                        <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, setSeal)} style={{ display: 'none' }} />
                      </label>
                    </div>
                  </div>

                  {/* Stamp Upload */}
                  <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label className="form-label">Company Stamp</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      {stamp && <img src={stamp} alt="Stamp" style={{ width: '40px', height: '40px', objectFit: 'contain' }} />}
                      <label className="btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                        <Upload size={12} />
                        <span>Upload</span>
                        <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, setStamp)} style={{ display: 'none' }} />
                      </label>
                    </div>
                  </div>
                </div>

                {/* Toggles */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                  padding: '1rem',
                  background: 'var(--bg-canvas)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <input type="checkbox" id="t-bank" checked={showBankDetails} onChange={(e) => setShowBankDetails(e.target.checked)} style={{ width: 'auto' }} />
                    <label htmlFor="t-bank" style={{ fontSize: '0.85rem', fontWeight: 500 }}>Include Bank account block on sheets</label>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <input type="checkbox" id="t-sig" checked={showSignature} onChange={(e) => setShowSignature(e.target.checked)} style={{ width: 'auto' }} />
                    <label htmlFor="t-sig" style={{ fontSize: '0.85rem', fontWeight: 500 }}>Include Seal/Stamp & Signature block</label>
                  </div>
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Signature Text Label (e.g. Director Name)</label>
                    <input type="text" placeholder="e.g. John Doe, Director" value={signatureText} onChange={(e) => setSignatureText(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Watermark Text (Diagonal background text)</label>
                    <input type="text" placeholder="e.g. DUPLICATE, DRAFT" value={watermarkText} onChange={(e) => setWatermarkText(e.target.value)} />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Default Terms and Conditions (New Documents)</label>
                  <textarea rows={3} value={defaultTerms} onChange={(e) => setDefaultTerms(e.target.value)} />
                </div>
              </div>

              {/* Custom Editable Column Names */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <h3 style={{ fontSize: '1.1rem' }}>Default Document Column Names</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '-0.75rem' }}>
                  Rename the default column titles for line item tables generated by this profile.
                </p>

                <div className="grid-5" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Description Col</label>
                    <input type="text" value={colDesc} onChange={(e) => setColDesc(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Quantity Col</label>
                    <input type="text" value={colQty} onChange={(e) => setColQty(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Unit Col</label>
                    <input type="text" value={colUnit} onChange={(e) => setColUnit(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Rate Col</label>
                    <input type="text" value={colRate} onChange={(e) => setColRate(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Amount Col</label>
                    <input type="text" value={colAmt} onChange={(e) => setColAmt(e.target.value)} />
                  </div>
                </div>
              </div>

              {/* Sequencing Settings */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <h3 style={{ fontSize: '1.1rem' }}>Unified Prefix & Auto-Sequencing</h3>
                
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Invoice Prefix</label>
                    <input type="text" value={invoicePrefix} onChange={(e) => setInvoicePrefix(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Invoice Start Number</label>
                    <input type="number" value={invoiceStart} onChange={(e) => setInvoiceStart(Number(e.target.value))} />
                  </div>
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Proforma Invoice Prefix</label>
                    <input type="text" value={proformaPrefix} onChange={(e) => setProformaPrefix(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Proforma Start Number</label>
                    <input type="number" value={proformaStart} onChange={(e) => setProformaStart(Number(e.target.value))} />
                  </div>
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Quotation Prefix</label>
                    <input type="text" value={quotationPrefix} onChange={(e) => setQuotationPrefix(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Quotation Start Number</label>
                    <input type="number" value={quotationStart} onChange={(e) => setQuotationStart(Number(e.target.value))} />
                  </div>
                </div>

                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Work Order Prefix</label>
                    <input type="text" value={workOrderPrefix} onChange={(e) => setWorkOrderPrefix(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Work Order Start Number</label>
                    <input type="number" value={workOrderStart} onChange={(e) => setWorkOrderStart(Number(e.target.value))} />
                  </div>
                </div>
              </div>

              {/* Submit Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                <button type="submit" className="btn-primary" disabled={saving} style={{ padding: '0.75rem 2rem' }}>
                  {saving ? 'Saving Config...' : 'Save Configuration'}
                </button>
              </div>

            </form>
            </fieldset>
          )}

          {activeTab === 'sheets' && (
            <fieldset disabled={role !== 'admin'} style={{ border: 'none', padding: 0, margin: 0, display: 'contents' }}>
            <div className="card animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  background: 'rgba(16, 185, 129, 0.1)',
                  color: 'var(--accent-success)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Building size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.1rem', margin: 0 }}>Google Sheets Auto-Save Integration</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                    Automatically log invoices, quotations, and work orders to a Google Sheet on save.
                  </p>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Google Apps Script Web App Webhook URL</label>
                <input
                  type="url"
                  placeholder="https://script.google.com/macros/s/.../exec"
                  value={googleSheetsUrl}
                  onChange={(e) => setGoogleSheetsUrl(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                  type="button"
                  onClick={handleSave}
                  className="btn-primary"
                  disabled={saving}
                >
                  Save Webhook URL
                </button>

                <button
                  type="button"
                  onClick={handleTestConnection}
                  className="btn-secondary"
                  disabled={testingConnection || !googleSheetsUrl}
                >
                  {testingConnection ? 'Testing...' : 'Test Connection'}
                </button>
              </div>

              <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)' }} />

              <div>
                <h4 style={{ fontSize: '0.95rem', marginBottom: '0.5rem', fontWeight: 600 }}>Setup Instructions</h4>
                <ol style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <li>Create a new Google Sheet or open an existing one.</li>
                  <li>In the top menu, click on <strong>Extensions</strong> &gt; <strong>Apps Script</strong>.</li>
                  <li>Delete any placeholder code and paste the script template below:</li>
                </ol>
              </div>

              <div style={{
                background: 'var(--bg-canvas)',
                padding: '1.25rem',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                position: 'relative'
              }}>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(APPS_SCRIPT_TEMPLATE);
                    alert('Apps Script template copied to clipboard!');
                  }}
                  className="btn-secondary"
                  style={{
                    position: 'absolute',
                    top: '0.75rem',
                    right: '0.75rem',
                    padding: '0.4rem 0.8rem',
                    fontSize: '0.75rem'
                  }}
                >
                  Copy Template
                </button>
                <pre style={{
                  margin: 0,
                  fontSize: '0.75rem',
                  fontFamily: 'JetBrains Mono, monospace',
                  overflowX: 'auto',
                  maxHeight: '250px',
                  lineHeight: '1.4',
                  color: 'var(--text-primary)'
                }}>
                  {APPS_SCRIPT_TEMPLATE}
                </pre>
              </div>

              <div>
                <ol start={4} style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <li>Click the <strong>Deploy</strong> button in the upper right, then choose <strong>New deployment</strong>.</li>
                  <li>Select <strong>Web app</strong> as the deployment type (click the gear icon next to "Select type" if Web App is not visible).</li>
                  <li>Set <strong>Execute as:</strong> "Me" and <strong>Who has access:</strong> "Anyone".</li>
                  <li>Click <strong>Deploy</strong>, authorize the permissions, and copy the generated <strong>Web App URL</strong>.</li>
                  <li>Paste the Web App URL in the field above and click <strong>Save Webhook URL</strong>.</li>
                </ol>
              </div>
            </div>
            </fieldset>
          )}

          {activeTab === 'database' && (
            <div className="card animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  background: 'rgba(37,99,235,0.1)',
                  color: 'var(--accent-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Database size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.1rem', margin: 0 }}>Supabase SQL Schema</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                    Copy this database setup schema and paste it into your Supabase SQL Editor.
                  </p>
                </div>
              </div>

              <div style={{
                background: 'var(--bg-canvas)',
                padding: '1.25rem',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                position: 'relative'
              }}>
                <button
                  onClick={copySchemaToClipboard}
                  className="btn-secondary"
                  style={{
                    position: 'absolute',
                    top: '0.75rem',
                    right: '0.75rem',
                    padding: '0.4rem 0.8rem',
                    fontSize: '0.75rem'
                  }}
                >
                  {copied ? <Check size={12} style={{ color: 'var(--accent-success)' }} /> : null}
                  <span>{copied ? 'Copied!' : 'Copy Schema'}</span>
                </button>
                
                <pre style={{
                  margin: 0,
                  fontSize: '0.8rem',
                  fontFamily: 'JetBrains Mono, monospace',
                  overflowX: 'auto',
                  maxHeight: '400px',
                  lineHeight: '1.4',
                  color: 'var(--text-primary)'
                }}>
                  {SQL_SCHEMA}
                </pre>
              </div>

              <div style={{
                display: 'flex',
                gap: '0.75rem',
                padding: '1rem',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(37, 99, 235, 0.05)',
                border: '1px solid rgba(37, 99, 235, 0.2)',
                color: 'var(--text-secondary)',
                fontSize: '0.85rem'
              }}>
                <Info size={18} style={{ flexShrink: 0, marginTop: '2px', color: 'var(--accent-primary)' }} />
                <span>
                  <strong>Tip:</strong> Once you execute this script in Supabase, and enter your <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> env variables, this setup tab will be hidden and database records will sync online.
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const APPS_SCRIPT_TEMPLATE = `function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Timestamp", 
        "Company Profile", 
        "Document Number", 
        "Document Type", 
        "Customer Name", 
        "Customer GSTIN", 
        "Issue Date", 
        "Due Date", 
        "Subtotal", 
        "Tax (GST)", 
        "Discount", 
        "Grand Total", 
        "Status", 
        "Items Summary"
      ]);
    }
    
    var itemsSummary = data.items.map(function(it) {
      return it.qty + " " + it.unit + " x " + it.description + " (@" + it.rate + ")";
    }).join("; ");
    
    sheet.appendRow([
      new Date(),
      data.company_name,
      data.document_number,
      data.document_type,
      data.customer_name,
      data.customer_gstin || "-",
      data.issue_date,
      data.due_date,
      data.subtotal,
      data.tax_total,
      data.discount_total,
      data.total,
      data.status,
      itemsSummary
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader("Access-Control-Allow-Origin", "*");
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.message }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader("Access-Control-Allow-Origin", "*");
  }
}

function doOptions(e) {
  return ContentService.createTextOutput("")
    .setHeader("Access-Control-Allow-Origin", "*")
    .setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
    .setHeader("Access-Control-Allow-Headers", "Content-Type");
}`;

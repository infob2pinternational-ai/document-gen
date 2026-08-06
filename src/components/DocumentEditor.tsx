import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { CompanyProfile, Customer, Service, Document, DocumentItem, DocumentType } from '../types';
import { dbService } from '../services/db';
import { sendApprovalNotification } from '../services/push';
import { ArrowLeft, Plus, Trash2, GripVertical, Save, Pencil, Copy, AlertTriangle, X } from 'lucide-react';
import { LineItemModal } from './LineItemModal';
import { DocumentSuccessDialog } from './DocumentSuccessDialog';
import { DocumentPreview } from './DocumentPreview';
import { calculateDocumentTotals } from '../utils/calculations';
import {
  getDraftKey,
  getTabId,
  restoreDraft,
  deleteDraft,
  migrateLegacyDraft,
  migrateOldNewDraftKeyFormat,
  createDraftSaver,
  type DraftPayload,
  type DraftSaverStatus
} from '../utils/drafts';

interface DocumentEditorProps {
  activeProfile: CompanyProfile | null;
  documentToEdit: Document | null; // null if creating
  onClose: () => void;
  onRefreshDocs: () => void;
  // Kept for backward compatibility with App.tsx's existing prop wiring
  // (not yet updated - see Phase A3). DocumentEditor now manages its own
  // draft restoration internally via src/utils/drafts.ts and no longer
  // reads this prop for the primary restore path; it's only consulted
  // as a fallback if the new draft system finds nothing (e.g. a draft
  // left over from immediately before this change shipped).
  draftToRestore?: any;
}

export const DocumentEditor: React.FC<DocumentEditorProps> = ({
  activeProfile,
  documentToEdit,
  onClose,
  onRefreshDocs,
  draftToRestore
}) => {
  // Database Libraries
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  // Main Document States
  const [docType, setDocType] = useState<DocumentType>('invoice');
  const [docNumber, setDocNumber] = useState('');
  const [sequenceNumber, setSequenceNumber] = useState<number>(1001);
  const [date, setDate] = useState('');

  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [discountTotal, setDiscountTotal] = useState<number>(0);

  // Customer Billing Details
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerGstin, setCustomerGstin] = useState('');

  // Editable Column Names
  const [colDesc, setColDesc] = useState('Description');
  const [colQty, setColQty] = useState('Quantity');
  const [colUnit, setColUnit] = useState('Unit');
  const [colRate, setColRate] = useState('Rate');
  const [colAmt, setColAmt] = useState('Amount');

  // Document Items & Modal States
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [itemToEdit, setItemToEdit] = useState<DocumentItem | null>(null);

  // Confirmation Success Dialog & Document Preview States
  const [successData, setSuccessData] = useState<{
    document: Document;
    items: DocumentItem[];
    isEditMode: boolean;
  } | null>(null);
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);

  // ─── Draft Recovery (Phase A2/A2.1) ─────────────────────────────────
  // For edits, stable for the component's lifetime (documentToEdit.id
  // never changes without a remount). For new documents, scoped by
  // docType too - recomputed each render so it correctly tracks the
  // in-editor type dropdown (see the cleanup effect below, which
  // deletes the previous type-scoped draft when this changes).
  const draftKey = getDraftKey(documentToEdit?.id ?? null, docType);
  const [draftStatus, setDraftStatus] = useState<DraftSaverStatus>({
    dirty: false,
    lastSaved: null,
    saveFailed: false
  });
  const [draftRestoredNotice, setDraftRestoredNotice] = useState(false);
  const [draftSaver] = useState(() =>
    createDraftSaver(5000, 30000, (status) => setDraftStatus(status))
  );
  // Guards the mount effect below from re-running its restore-or-init
  // logic if activeProfile happens to change identity after mount.
  const hasInitializedRef = useRef(false);
  // Tracks which document identity (its id, or 'new') the init effect
  // below has already run for. Needed in addition to hasInitializedRef:
  // that effect depends on `activeProfile`, and App.tsx's loadData()
  // hands down a brand-new activeProfile object every time it re-runs -
  // including on Supabase's automatic session check when the tab
  // regains focus (switching browser tabs, minimizing, alt-tabbing).
  // Without this, that identity churn alone re-ran the "load from DB" /
  // "reset to blank" branches below on every tab-focus change, silently
  // wiping the in-progress draft even though it was safely persisted.
  const initializedForKeyRef = useRef<string | null>(null);
  // Tracks the previous type-scoped draft key so switching the doc-type
  // dropdown mid-session (new documents only) can clean up the
  // now-abandoned key instead of leaving an orphaned draft behind.
  const prevDraftKeyRef = useRef<string | null>(null);

  const buildDraftFields = useCallback(() => ({
    docType, docNumber, sequenceNumber, date, notes, terms, discountTotal,
    selectedCustomerId, customerName, customerEmail, customerPhone,
    customerAddress, customerGstin, colDesc, colQty, colUnit, colRate, colAmt, items
  }), [
    docType, docNumber, sequenceNumber, date, notes, terms, discountTotal,
    selectedCustomerId, customerName, customerEmail, customerPhone,
    customerAddress, customerGstin, colDesc, colQty, colUnit, colRate, colAmt, items
  ]);

  const buildDraftPayload = useCallback((): DraftPayload => ({
    draftKey,
    documentId: documentToEdit?.id ?? null,
    editorType: 'document',
    fields: buildDraftFields(),
    lastSaved: '', // overwritten by createDraftSaver at write time
    tabId: getTabId()
  }), [draftKey, documentToEdit, buildDraftFields]);

  const handleDiscardDraft = () => {
    if (!confirm('Discard this draft? Your unsaved changes will be permanently lost.')) return;
    deleteDraft(draftKey);
    draftSaver.cancel();
    setDraftStatus({ dirty: false, lastSaved: null, saveFailed: false });
    onClose();
  };

  const handleOpenAddItemModal = () => {
    setItemToEdit(null);
    setIsItemModalOpen(true);
  };

  const handleOpenEditItemModal = (item: DocumentItem) => {
    setItemToEdit(item);
    setIsItemModalOpen(true);
  };

  const handleDuplicateItem = (index: number) => {
    const target = items[index];
    if (!target) return;
    const cloned: DocumentItem = {
      ...target,
      id: crypto.randomUUID(),
      description: target.description ? `${target.description} (Copy)` : 'Copy',
      sort_order: items.length
    };
    setItems([...items, cloned]);
  };

  const handleSaveItemFromModal = (savedItem: DocumentItem) => {
    let updated: DocumentItem[];
    const existingIdx = items.findIndex(i => i.id === savedItem.id);
    if (existingIdx > -1) {
      updated = [...items];
      updated[existingIdx] = savedItem;
    } else {
      updated = [...items, { ...savedItem, sort_order: items.length }];
    }
    setItems(updated);

    const totalItemDiscounts = updated.reduce((sum, item) => sum + (item.discount_amount || 0), 0);
    if (totalItemDiscounts > 0 || savedItem.discount_amount !== undefined) {
      setDiscountTotal(totalItemDiscounts);
    }
  };

  // Drag and Drop States
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Load Customers and Services libraries
  useEffect(() => {
    const loadLibraries = async () => {
      if (!activeProfile) return;
      try {
        const [cList, sList] = await Promise.all([
          dbService.getCustomers(activeProfile.id),
          dbService.getServices()
        ]);
        setCustomers(cList);
        setServices(sList);
      } catch (err) {
        console.error('Error loading libraries:', err);
      }
    };
    loadLibraries();
  }, [activeProfile]);

  // One-time migration of the pre-Phase-A single-draft format into the
  // new per-document draft system. Safe to call on every mount - it's a
  // no-op once the legacy key has already been migrated away.
  useEffect(() => {
    migrateLegacyDraft();
  }, []);

  // Flush any pending draft write immediately when the editor unmounts
  // (navigating away, closing the tab is handled separately since drafts
  // are NOT deleted on close - see handleCloseEditor equivalent below).
  // draftSaver is stable for the component's lifetime (useState lazy
  // init, setter never called), so listing it here never causes this
  // effect to re-run - it still only fires its cleanup on unmount.
  useEffect(() => {
    return () => {
      draftSaver.flush();
    };
  }, [draftSaver]);

  // Clean up the previous type-scoped draft key when docType changes
  // mid-session for a NEW document (the in-editor dropdown, not
  // editing an existing one - those are always keyed by stable id
  // regardless of type). Without this, switching Invoice -> Quotation
  // would leave an orphaned "new:invoice:{tabId}" draft behind.
  useEffect(() => {
    if (documentToEdit) return; // edits are keyed by id, not type - nothing to clean up
    if (!hasInitializedRef.current) {
      // Still establishing the initial key (first render, or the
      // render where a restored draft's docType is being applied) -
      // record it without deleting anything yet.
      prevDraftKeyRef.current = draftKey;
      return;
    }
    if (prevDraftKeyRef.current && prevDraftKeyRef.current !== draftKey) {
      deleteDraft(prevDraftKeyRef.current);
    }
    prevDraftKeyRef.current = draftKey;
  }, [draftKey, documentToEdit]);

  // Set default sequences and values on Create
  useEffect(() => {
    if (!activeProfile) return;

    // Bail out entirely if we've already initialized (or started
    // initializing) for this exact document identity - see
    // initializedForKeyRef's declaration for why this is necessary
    // beyond hasInitializedRef alone. Set immediately (not just on
    // completion) so a second effect fire while an async load is still
    // in flight doesn't kick off a duplicate.
    const targetKey = documentToEdit?.id ?? 'new';
    if (initializedForKeyRef.current === targetKey) return;
    initializedForKeyRef.current = targetKey;

    // Draft restoration takes priority over both the legacy prop-based
    // restore and the normal edit/create-mode initialization. Only
    // attempted once per mount - if the editor's own state changes
    // later (e.g. activeProfile identity changes), we don't want to
    // silently discard the user's in-progress work by re-restoring.
    if (!hasInitializedRef.current) {
      let found = restoreDraft(draftKey);

      // One-time migration path: a new-document draft saved before the
      // per-type key scoping shipped won't be found under the new
      // `new:{docType}:{tabId}` key format. Check the old `new:{tabId}`
      // format once and re-key it using its own stored docType.
      if (!found && !documentToEdit) {
        const migrated = migrateOldNewDraftKeyFormat();
        if (migrated) {
          found = { draft: migrated, source: 'recovery' };
        }
      }

      if (found) {
        const f = found.draft.fields;
        setDocType(f.docType);
        setDocNumber(f.docNumber);
        setSequenceNumber(f.sequenceNumber);
        setDate(f.date);
        setNotes(f.notes);
        setTerms(f.terms);
        setDiscountTotal(f.discountTotal);
        setSelectedCustomerId(f.selectedCustomerId);
        setCustomerName(f.customerName);
        setCustomerEmail(f.customerEmail);
        setCustomerPhone(f.customerPhone);
        setCustomerAddress(f.customerAddress);
        setCustomerGstin(f.customerGstin);
        setColDesc(f.colDesc);
        setColQty(f.colQty);
        setColUnit(f.colUnit);
        setColRate(f.colRate);
        setColAmt(f.colAmt);
        setItems(f.items);
        setDraftRestoredNotice(true);
        hasInitializedRef.current = true;
        return;
      }
    }

    if (!hasInitializedRef.current && draftToRestore) {
      // Backward-compat fallback: a draft handed down via the old prop
      // path (see interface comment above) and not yet migrated/found
      // by the new system.
      setDocType(draftToRestore.docType);
      setDocNumber(draftToRestore.docNumber);
      setSequenceNumber(draftToRestore.sequenceNumber);
      setDate(draftToRestore.date);
      setNotes(draftToRestore.notes);
      setTerms(draftToRestore.terms);
      setDiscountTotal(draftToRestore.discountTotal);
      setSelectedCustomerId(draftToRestore.selectedCustomerId);
      setCustomerName(draftToRestore.customerName);
      setCustomerEmail(draftToRestore.customerEmail);
      setCustomerPhone(draftToRestore.customerPhone);
      setCustomerAddress(draftToRestore.customerAddress);
      setCustomerGstin(draftToRestore.customerGstin);
      setColDesc(draftToRestore.colDesc);
      setColQty(draftToRestore.colQty);
      setColUnit(draftToRestore.colUnit);
      setColRate(draftToRestore.colRate);
      setColAmt(draftToRestore.colAmt);
      setItems(draftToRestore.items);
      setDraftRestoredNotice(true);
      hasInitializedRef.current = true;
    } else if (documentToEdit) {
      // Editing Mode
      const loadDocData = async () => {
        try {
          const res = await dbService.getDocumentById(documentToEdit.id);
          if (res) {
            const { document, items: docItems } = res;
            setDocType(document.document_type);
            setDocNumber(document.document_number);
            setSequenceNumber(document.sequence_number);
            setDate(document.date || '');

            setNotes(document.notes || '');
            setTerms(document.terms || '');
            setDiscountTotal(Number(document.discount_total));

            // Customer
            setSelectedCustomerId(document.customer_id || '');
            setCustomerName(document.customer_name);
            setCustomerEmail(document.customer_email || '');
            setCustomerPhone(document.customer_phone || '');
            setCustomerAddress(document.customer_address || '');
            setCustomerGstin(document.customer_gstin || '');

            // Columns
            setColDesc(document.col_name_description);
            setColQty(document.col_name_quantity);
            setColUnit(document.col_name_unit);
            setColRate(document.col_name_rate);
            setColAmt(document.col_name_amount);

            // Line items
            setItems(docItems);
          }
        } catch (err) {
          console.error('Error loading document details:', err);
          alert('Failed to load document details.');
        } finally {
          hasInitializedRef.current = true;
        }
      };
      loadDocData();
    } else {
      // Create Mode
      const today = new Date().toISOString().split('T')[0];
      setDate(today);

      
      // Load column names from profile
      setColDesc(activeProfile.col_name_description || 'Description');
      setColQty(activeProfile.col_name_quantity || 'Quantity');
      setColUnit(activeProfile.col_name_unit || 'Unit');
      setColRate(activeProfile.col_name_rate || 'Rate');
      setColAmt(activeProfile.col_name_amount || 'Amount');

      setTerms(activeProfile.default_terms || '');
      setItems([]);
      setNotes('');
      setDiscountTotal(0);
      setSelectedCustomerId('');
      setCustomerName('');
      setCustomerEmail('');
      setCustomerPhone('');
      setCustomerAddress('');
      setCustomerGstin('');
      
      // Auto-sequence numbers
      generateSequenceNumber(docType);
      hasInitializedRef.current = true;
    }
  }, [documentToEdit, activeProfile, draftToRestore]);

  // Handle document type change -> update sequence
  useEffect(() => {
    if (!documentToEdit && activeProfile) {
      generateSequenceNumber(docType);
    }
  }, [docType]);

  // Autosave Draft — Phase A2: debounced via drafts.ts's createDraftSaver
  // instead of writing to localStorage directly on every keystroke.
  // markDirty() debounces the actual write internally (5s for the
  // session layer; the recovery layer is covered by its own 30s floor
  // timer inside createDraftSaver) - this effect firing on every
  // keystroke is fine, since it's now just scheduling, not writing.
  useEffect(() => {
    // Skip marking dirty until initial load/restore has completed, so
    // we don't overwrite a just-restored or freshly-loaded document with
    // an empty in-progress draft during the render right after mount.
    if (!hasInitializedRef.current) return;
    // Only save draft if items are present or customer name is filled (avoid saving empty blanks)
    if (items.length > 0 || customerName || notes || selectedCustomerId) {
      draftSaver.markDirty(buildDraftPayload());
    }
  }, [
    documentToEdit,
    docType,
    docNumber,
    sequenceNumber,
    date,
    notes,
    terms,
    discountTotal,
    selectedCustomerId,
    customerName,
    customerEmail,
    customerPhone,
    customerAddress,
    customerGstin,
    colDesc,
    colQty,
    colUnit,
    colRate,
    colAmt,
    items,
    buildDraftPayload,
    draftSaver
  ]);

  // Sequence generator
  const generateSequenceNumber = async (type: DocumentType) => {
    if (!activeProfile) return;
    
    let prefix = 'INV/';
    let startSeq = 1001;

    if (type === 'invoice') {
      prefix = activeProfile.invoice_prefix || 'INV/';
      startSeq = Number(activeProfile.invoice_start_number) || 1001;
    } else if (type === 'proforma_invoice') {
      prefix = activeProfile.proforma_prefix || 'PI/';
      startSeq = Number(activeProfile.proforma_start_number) || 1001;
    } else if (type === 'quotation') {
      prefix = activeProfile.quotation_prefix || 'QTN/';
      startSeq = Number(activeProfile.quotation_start_number) || 1001;
    } else if (type === 'work_order') {
      prefix = activeProfile.work_order_prefix || 'WO/';
      startSeq = Number(activeProfile.work_order_start_number) || 1001;
    } else if (type === 'non_tax_invoice') {
      prefix = activeProfile.non_tax_prefix || 'NT/';
      startSeq = Number(activeProfile.non_tax_start_number) || 1001;
    }

    // Set immediate non-blank default
    setSequenceNumber(startSeq);
    setDocNumber(`${prefix}${startSeq}`);

    try {
      const allDocs = await dbService.getDocuments(activeProfile.id);
      
      let maxExistingSeq = 0;
      allDocs.forEach(d => {
        if (d.document_number && d.document_number.startsWith(prefix)) {
          const numPart = d.document_number.substring(prefix.length).trim();
          const parsed = parseInt(numPart, 10);
          if (!isNaN(parsed) && parsed > maxExistingSeq) {
            maxExistingSeq = parsed;
          }
        }
      });

      let nextSeq = Math.max(startSeq, maxExistingSeq + 1);

      while (allDocs.some(d => d.document_number === `${prefix}${nextSeq}`)) {
        nextSeq++;
      }

      setSequenceNumber(nextSeq);
      setDocNumber(`${prefix}${nextSeq}`);
    } catch (err) {
      console.error('Error generating sequence:', err);
    }
  };



  // Customer dropdown select
  const handleCustomerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const custId = e.target.value;
    setSelectedCustomerId(custId);

    const cust = customers.find(c => c.id === custId);
    if (cust) {
      setCustomerName(cust.name);
      setCustomerEmail(cust.email || '');
      setCustomerPhone(cust.phone || '');
      setCustomerAddress(cust.address || '');
      setCustomerGstin(cust.gstin || '');
    } else {
      setCustomerName('');
      setCustomerEmail('');
      setCustomerPhone('');
      setCustomerAddress('');
      setCustomerGstin('');
    }
  };

  // Line item CRUD & Calculations
  const removeLineItem = (index: number) => {
    const updated = items.filter((_, idx) => idx !== index);
    setItems(updated.map((item, idx) => ({ ...item, sort_order: idx })));
  };

  // Shared Document Totals calculations
  const { subtotal, taxableAmount, taxTotal, total, effectiveGstRate } = calculateDocumentTotals(items, discountTotal, docType);

  // Save Document
  const handleSaveDoc = async () => {
    if (!activeProfile) return;
    if (!customerName) {
      alert('Please specify a Customer Name.');
      return;
    }
    if (items.length === 0) {
      alert('Please add at least one line item.');
      return;
    }
    const isB2PInternational = activeProfile.name.toLowerCase().includes('international');
    if (docType === 'invoice' && !isB2PInternational && (!activeProfile.gstin || !activeProfile.gstin.trim())) {
      alert('To save a Tax Invoice, your Company GSTIN is mandatory. Please add your GSTIN in Settings > Company Profile.');
      return;
    }

    setLoading(true);
    try {
      const docId = documentToEdit?.id || crypto.randomUUID();

      // Check if this is a new customer and auto-save to CRM list if it doesn't exist (match by name or phone)
      let finalCustomerId = selectedCustomerId;
      if (customerName.trim()) {
        const trimmedPhone = customerPhone.trim();
        const existingCust = customers.find(c => {
          const nameMatch = c.name.trim().toLowerCase() === customerName.trim().toLowerCase();
          const phoneMatch = trimmedPhone && c.phone && c.phone.trim() === trimmedPhone;
          return nameMatch || phoneMatch;
        });

        if (existingCust) {
          finalCustomerId = existingCust.id;
        } else {
          const newCustId = crypto.randomUUID();
          const newCust: Customer = {
            id: newCustId,
            company_id: activeProfile.id,
            name: customerName.trim(),
            email: customerEmail.trim() || undefined,
            phone: customerPhone.trim() || undefined,
            address: customerAddress.trim() || undefined,
            gstin: customerGstin.trim() || undefined
          };
          await dbService.saveCustomer(newCust);
          finalCustomerId = newCustId;
        }
      }
      
      const docPayload: Document = {
        id: docId,
        company_id: activeProfile.id,
        document_type: docType,
        document_number: docNumber,
        sequence_number: sequenceNumber,
        customer_id: finalCustomerId || undefined,
        customer_name: customerName,
        customer_email: customerEmail || undefined,
        customer_phone: customerPhone || undefined,
        customer_address: customerAddress || undefined,
        customer_gstin: customerGstin || undefined,
        date,
        col_name_description: colDesc,
        col_name_quantity: colQty,
        col_name_unit: colUnit,
        col_name_rate: colRate,
        col_name_amount: colAmt,
        subtotal,
        tax_total: taxTotal,
        discount_total: discountTotal,
        total,
        notes,
        terms,
        status: 'pending_approval' // Reset status to pending_approval on edit/save (amendment)
      };

      // Map document_id to line items
      const itemsPayload = items.map(it => ({
        ...it,
        document_id: docId,
        gst_percentage: docType === 'non_tax_invoice' ? 0 : it.gst_percentage
      }));

      await dbService.saveDocument(docPayload, itemsPayload);

      // Trigger FCM push notification asynchronously in the background (fire-and-forget)
      // to prevent blocking the UI save action
      sendApprovalNotification(activeProfile, docPayload).catch(pushErr => {
        console.error('[Push Trigger] Failed to send approval notification:', pushErr);
      });

      // Trigger Google Sheets Auto-Save with text/plain header (bypassing CORS preflight issues)
      if (activeProfile.google_sheets_url) {
        dbService.syncDocumentToGoogleSheets(
          activeProfile.google_sheets_url,
          activeProfile.name,
          docPayload,
          itemsPayload
        ).catch(err => console.error('Failed to auto-save to Google Sheet:', err));
      }

      // Draft cleanup — only after a CONFIRMED successful save (per
      // requirement: never delete on anything less than success).
      deleteDraft(draftKey);
      draftSaver.cancel();
      setDraftStatus({ dirty: false, lastSaved: null, saveFailed: false });

      onRefreshDocs();
      setSuccessData({
        document: docPayload,
        items: itemsPayload,
        isEditMode: Boolean(documentToEdit)
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      alert(`Failed to save document: ${errorMsg}\n\n(Please ensure you have executed the SQL migration scripts in your Supabase SQL Editor under "SQL Editor")`);
    } finally {
      setLoading(false);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (index: number) => {
    if (draggedIndex === null) return;
    const updated = [...items];
    const [removed] = updated.splice(draggedIndex, 1);
    updated.splice(index, 0, removed);
    
    setItems(updated.map((item, idx) => ({ ...item, sort_order: idx })));
    setDraggedIndex(null);
  };

  if (previewDoc) {
    return (
      <DocumentPreview
        activeProfile={activeProfile}
        document={previewDoc}
        onClose={() => {
          setPreviewDoc(null);
          onRefreshDocs();
          onClose();
        }}
      />
    );
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Editor Header */}
      <div className="editor-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button onClick={onClose} className="btn-secondary" style={{ padding: '0.5rem', borderRadius: '50%' }}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
              {documentToEdit ? `Edit ${docType.replace('_', ' ')}` : `Create ${docType.replace('_', ' ')}`}
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '2px 0 0 0' }}>
              Sequence details and custom branding will be locked upon save.
            </p>
            {/* Draft status indicators (Phase A2) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '4px', minHeight: '1.1rem' }}>
              {draftStatus.saveFailed && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: 'var(--danger, #dc2626)' }}>
                  <AlertTriangle size={12} />
                  Draft save failed — retrying...
                </span>
              )}
              {!draftStatus.saveFailed && draftStatus.dirty && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  ● Unsaved changes
                </span>
              )}
              {!draftStatus.saveFailed && !draftStatus.dirty && draftStatus.lastSaved && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  Draft saved at {new Date(draftStatus.lastSaved).toLocaleTimeString()}
                </span>
              )}
            </div>
            {draftRestoredNotice && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px',
                fontSize: '0.8rem', color: 'var(--primary, #2563eb)',
                background: 'var(--primary-bg, rgba(37, 99, 235, 0.08))',
                padding: '4px 8px', borderRadius: '6px', width: 'fit-content'
              }}>
                <span>Draft restored from your last session.</span>
                <button
                  onClick={() => setDraftRestoredNotice(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'inherit' }}
                  aria-label="Dismiss"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="editor-header-buttons">
          <button onClick={handleDiscardDraft} className="btn-secondary" title="Permanently discard this draft">
            <Trash2 size={14} />
            <span>Discard Draft</span>
          </button>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={handleSaveDoc} className="btn-primary" disabled={loading}>
            <Save size={16} />
            <span>{loading ? 'Saving...' : 'Save Document'}</span>
          </button>
        </div>
      </div>

      {/* Editor Body */}
      <div className="editor-layout">
        
        {/* Left Columns: Form Fields & Table */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Metadata Block */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Document Configuration</h3>
            
            <div className="grid-3">
              <div className="form-group">
                <label className="form-label">Document Type</label>
                <select 
                  value={docType} 
                  onChange={(e) => setDocType(e.target.value as DocumentType)}
                  disabled={!!documentToEdit} // cannot change type on edit
                >
                  <option value="invoice">Tax Invoice</option>
                  <option value="non_tax_invoice">Invoice</option>
                  <option value="proforma_invoice">Proforma Invoice</option>
                  <option value="quotation">Quotation</option>
                  <option value="work_order">Work Order</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Document ID</label>
                <input 
                  type="text" 
                  value={docNumber} 
                  onChange={(e) => setDocNumber(e.target.value)} 
                />
              </div>

              <div className="form-group">
                <label className="form-label">Document Date</label>
                <input 
                  type="date" 
                  value={date} 
                  onChange={(e) => setDate(e.target.value)} 
                />
              </div>
            </div>
          </div>

          {/* Line Items Matrix */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '1rem', margin: 0 }}>Line Items Summary</h3>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Manage document services, rates, quantities, and tax specifications
                </p>
              </div>
              <button 
                type="button"
                onClick={handleOpenAddItemModal} 
                className="btn-primary" 
                style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <Plus size={16} />
                <span>Add Item</span>
              </button>
            </div>

            {/* Editable Columns Label Customizer */}
            <div className="rename-cols-grid">
              <div>
                <label style={{ fontSize: '0.7rem', display: 'block', color: 'var(--text-muted)' }}>Rename Desc Col</label>
                <input style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }} value={colDesc} onChange={(e) => setColDesc(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', display: 'block', color: 'var(--text-muted)' }}>Rename Qty Col</label>
                <input style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }} value={colQty} onChange={(e) => setColQty(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', display: 'block', color: 'var(--text-muted)' }}>Rename Unit Col</label>
                <input style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }} value={colUnit} onChange={(e) => setColUnit(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', display: 'block', color: 'var(--text-muted)' }}>Rename Rate Col</label>
                <input style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }} value={colRate} onChange={(e) => setColRate(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', display: 'block', color: 'var(--text-muted)' }}>Rename Amt Col</label>
                <input style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }} value={colAmt} onChange={(e) => setColAmt(e.target.value)} />
              </div>
            </div>

            {/* Clean ERP Line Items Summary Table */}
            <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--border-color, rgba(255,255,255,0.1))' }}>
              {items.length > 0 ? (
                <table className="erp-summary-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                      <th style={{ width: '130px' }}>Service</th>
                      <th>{colDesc}</th>
                      <th style={{ width: '80px', textAlign: 'center' }}>{colQty}</th>
                      <th style={{ width: '70px', textAlign: 'center' }}>{colUnit}</th>
                      <th style={{ width: '100px', textAlign: 'right' }}>{colRate}</th>
                      {docType !== 'non_tax_invoice' && (
                        <th style={{ width: '75px', textAlign: 'center' }}>Tax</th>
                      )}
                      <th style={{ width: '110px', textAlign: 'right' }}>{colAmt}</th>
                      <th style={{ width: '90px', textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => {
                      const matchedSrv = services.find(s => s.id === item.service_id);
                      const serviceName = matchedSrv ? matchedSrv.name : (item.service_id ? 'Preset Service' : 'Custom');
                      const currSymbol = activeProfile?.currency === 'INR' ? '₹' : (activeProfile?.currency === 'USD' ? '$' : (activeProfile?.currency || '₹') + ' ');
                      const lineTaxAmt = docType === 'non_tax_invoice' ? 0 : ((item.amount || 0) * (item.gst_percentage || 0) / 100);
                      const lineTotalWithTax = (item.amount || 0) + lineTaxAmt;

                      return (
                        <tr 
                          key={item.id}
                          draggable
                          onDragStart={() => handleDragStart(idx)}
                          onDragOver={handleDragOver}
                          onDrop={() => handleDrop(idx)}
                        >
                          <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px', cursor: 'grab' }}>
                              <GripVertical size={14} />
                              <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{idx + 1}</span>
                            </div>
                          </td>
                          <td>
                            <span style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--accent-primary, #3b82f6)', display: 'block' }}>
                              {serviceName}
                            </span>
                            {item.hsn_sac && (
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                HSN: {item.hsn_sac}
                              </span>
                            )}
                          </td>
                          <td style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45, fontSize: '0.825rem' }}>
                            {item.description}
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: 600 }}>
                            {item.quantity} {item.days && item.days > 1 ? `(${item.days}d)` : ''}
                          </td>
                          <td style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                            {item.unit || 'Unit'}
                          </td>
                          <td style={{ textAlign: 'right' }} className="mono">
                            {currSymbol}{(item.rate || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                          {docType !== 'non_tax_invoice' && (
                            <td style={{ textAlign: 'center' }}>
                              <span style={{ padding: '2px 6px', background: 'rgba(59,130,246,0.1)', color: 'var(--accent-primary)', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                                {item.gst_percentage || 0}%
                              </span>
                            </td>
                          )}
                          <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--accent-success)' }} className="mono">
                            {currSymbol}{lineTotalWithTax.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                              <button
                                type="button"
                                onClick={() => handleOpenEditItemModal(item)}
                                className="btn-secondary"
                                style={{ padding: '0.35rem', border: 'none', background: 'transparent', color: 'var(--accent-primary)' }}
                                title="Edit Item"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDuplicateItem(idx)}
                                className="btn-secondary"
                                style={{ padding: '0.35rem', border: 'none', background: 'transparent', color: 'var(--text-secondary)' }}
                                title="Duplicate Item"
                              >
                                <Copy size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeLineItem(idx)}
                                className="btn-secondary"
                                style={{ padding: '0.35rem', border: 'none', background: 'transparent', color: 'var(--accent-danger)' }}
                                title="Delete Item"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--bg-canvas)', borderRadius: 'var(--radius-sm)' }}>
                  <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>No items added yet</p>
                  <p style={{ margin: '0.35rem 0 1rem 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Click "+ Add Item" to specify services, rates, and specifications</p>
                  <button 
                    type="button"
                    onClick={handleOpenAddItemModal} 
                    className="btn-primary" 
                    style={{ padding: '0.45rem 1rem', fontSize: '0.8rem', fontWeight: 700, margin: '0 auto', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <Plus size={14} />
                    <span>Add First Item</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Line Item Popup Dialog Modal */}
        <LineItemModal
          isOpen={isItemModalOpen}
          onClose={() => setIsItemModalOpen(false)}
          onSaveItem={handleSaveItemFromModal}
          itemToEdit={itemToEdit}
          services={services}
          currency={activeProfile?.currency || 'INR'}
          isTaxableDoc={docType !== 'non_tax_invoice'}
          colDesc={colDesc}
          colQty={colQty}
          colUnit={colUnit}
          colRate={colRate}
        />

        {/* Right Column: Customer selector, terms and summary */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Customer CRM Selector */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Customer Details</h3>
            
            <div className="form-group">
              <label className="form-label">Load Saved Customer</label>
              <select value={selectedCustomerId} onChange={handleCustomerChange}>
                <option value="">-- Choose Customer --</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)' }} />

            <div className="form-group">
              <label className="form-label">Customer/Company Name *</label>
              <input 
                type="text" 
                value={customerName} 
                onChange={(e) => setCustomerName(e.target.value)} 
                placeholder="Billing Customer Name"
              />
            </div>

            <div className="form-group">
              <label className="form-label">GSTIN (Optional)</label>
              <input 
                type="text" 
                value={customerGstin} 
                onChange={(e) => setCustomerGstin(e.target.value.toUpperCase())} 
                placeholder="07AAAAA1111A1Z1"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Billing Address</label>
              <textarea 
                value={customerAddress} 
                onChange={(e) => setCustomerAddress(e.target.value)} 
                placeholder="Customer Address..."
                rows={3}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input 
                type="email" 
                value={customerEmail} 
                onChange={(e) => setCustomerEmail(e.target.value)} 
                placeholder="customer@domain.com"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Phone Number</label>
              <input 
                type="text" 
                value={customerPhone} 
                onChange={(e) => setCustomerPhone(e.target.value)} 
                placeholder="+91 99999 99999"
              />
            </div>
          </div>

          {/* Running Calculations and Totals */}
          <div className="card animate-fade-in" style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            background: 'var(--bg-input)'
          }}>
            <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>Financial Summary</h3>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Subtotal:</span>
              <span className="mono" style={{ fontWeight: 600 }}>
                {activeProfile?.currency === 'INR' ? '₹' : '$'}
                {subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Apply Discount ({activeProfile?.currency || '₹'})</label>
              <input 
                type="number" 
                value={discountTotal || ''} 
                onChange={(e) => setDiscountTotal(Number(e.target.value))} 
                placeholder="0.00"
                style={{ textAlign: 'right' }}
              />
            </div>

            {discountTotal > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Taxable Amount:</span>
                <span className="mono" style={{ fontWeight: 700 }}>
                  {activeProfile?.currency === 'INR' ? '₹' : '$'}
                  {taxableAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            )}

            {docType !== 'non_tax_invoice' && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  GST {effectiveGstRate > 0 ? `(${effectiveGstRate.toFixed(0)}%)` : ''}:
                </span>
                <span className="mono" style={{ fontWeight: 600 }}>
                  {activeProfile?.currency === 'INR' ? '₹' : '$'}
                  {taxTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            )}

            <hr style={{ border: 'none', borderBottom: '1px solid var(--border-color)', margin: '0.25rem 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600 }}>Grand Total:</span>
              <span className="mono" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--accent-primary)' }}>
                {activeProfile?.currency === 'INR' ? '₹' : '$'}
                {total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Terms & Notes */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Payment Terms / Period</label>
              <textarea 
                value={terms} 
                onChange={(e) => setTerms(e.target.value)} 
                placeholder="e.g. Net 15 days, 50% advance..."
                rows={2}
              />
            </div>
            
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Service Name & Period</label>
              <input 
                type="text"
                value={notes} 
                onChange={(e) => setNotes(e.target.value)} 
                placeholder="e.g. led van advertisement"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Reusable Document Success Confirmation Dialog */}
      {successData && (
        <DocumentSuccessDialog
          isOpen={Boolean(successData)}
          isEditMode={successData.isEditMode}
          document={successData.document}
          items={successData.items}
          profile={activeProfile}
          createdByName={activeProfile?.approver_email || activeProfile?.email}
          onClose={() => {
            setSuccessData(null);
            onRefreshDocs();
            onClose();
          }}
          onViewDocument={() => {
            const d = successData.document;
            setSuccessData(null);
            setPreviewDoc(d);
          }}
          onDownloadPdf={() => {
            const d = successData.document;
            setSuccessData(null);
            setPreviewDoc(d);
          }}
          onPrint={() => {
            const d = successData.document;
            setSuccessData(null);
            setPreviewDoc(d);
          }}
          onShare={() => {
            if (successData?.document) {
              const shareUrl = `${window.location.origin}/#doc=${successData.document.id}`;
              if (navigator.clipboard) {
                navigator.clipboard.writeText(shareUrl);
              }
            }
          }}
          onSendWhatsApp={() => {
            if (successData?.document?.customer_phone) {
              const phone = successData.document.customer_phone.replace(/[^0-9]/g, '');
              const formattedPhone = phone.length === 10 ? `91${phone}` : phone;
              const shareUrl = `${window.location.origin}/#doc=${successData.document.id}`;
              const docTypeLabel = successData.document.document_type.replace('_', ' ').toUpperCase();
              const messageText = `Hi ${successData.document.customer_name}, please find your ${docTypeLabel} #${successData.document.document_number} from ${activeProfile?.name}:\n${shareUrl}`;
              window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(messageText)}`, '_blank');
            }
          }}
          onCreateNew={() => {
            setSuccessData(null);
            onRefreshDocs();
            setItems([]);
            setNotes('');
            setDiscountTotal(0);
            setSelectedCustomerId('');
            setCustomerName('');
            setCustomerEmail('');
            setCustomerPhone('');
            setCustomerAddress('');
            setCustomerGstin('');
            if (activeProfile) {
              generateSequenceNumber(docType);
            }
          }}
        />
      )}
    </div>
  );
};

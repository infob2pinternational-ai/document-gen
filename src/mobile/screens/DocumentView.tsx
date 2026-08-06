import React, { useState } from 'react';
import type { CompanyProfile, Document } from '../../types';
import { DocumentPreview } from '../../components/DocumentPreview';
import { Check, X, Pencil } from 'lucide-react';

interface DocumentViewProps {
  document: Document;
  activeProfile: CompanyProfile | null;
  canApprove: boolean;
  canEdit: boolean;
  onClose: () => void;
  onEdit: (doc: Document) => void;
  onApprove: (doc: Document) => Promise<void>;
  onReject: (doc: Document) => Promise<void>;
}

/**
 * View-only DocumentPreview reuse (Phase 1), now with Approve/Reject
 * (Phase 1/2) and Edit (Phase 3) actions layered on top - all three call
 * straight into the same dbService methods / DocumentEditor component
 * the desktop app uses (see OwnerApp.tsx and DocumentEdit.tsx), no
 * duplicated approval or save logic.
 */
export const DocumentView: React.FC<DocumentViewProps> = ({
  document,
  activeProfile,
  canApprove,
  canEdit,
  onClose,
  onEdit,
  onApprove,
  onReject
}) => {
  const [actionLoading, setActionLoading] = useState<'approve' | 'reject' | null>(null);
  const isPending = document.status !== 'approved' && document.status !== 'rejected';

  const handleApprove = async () => {
    if (!window.confirm(`Are you sure you want to approve document ${document.document_number}?`)) return;
    setActionLoading('approve');
    try {
      await onApprove(document);
    } catch (err) {
      console.error(err);
      alert('Failed to approve document.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    if (!window.confirm(`Are you sure you want to reject document ${document.document_number}?`)) return;
    setActionLoading('reject');
    try {
      await onReject(document);
    } catch (err) {
      console.error(err);
      alert('Failed to reject document.');
    } finally {
      setActionLoading(null);
    }
  };

  const showActionBar = (isPending && canApprove) || canEdit;

  return (
    <div className="owner-shell">
      {showActionBar && (
        <div style={{ display: 'flex', gap: '0.5rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)' }}>
          {isPending && canApprove && (
            <>
              <button
                onClick={handleApprove}
                disabled={actionLoading !== null}
                className="btn-primary"
                style={{ flex: 1, minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', background: '#10b981' }}
              >
                <Check size={16} />
                <span>{actionLoading === 'approve' ? 'Approving...' : 'Approve'}</span>
              </button>
              <button
                onClick={handleReject}
                disabled={actionLoading !== null}
                className="btn-secondary"
                style={{ flex: 1, minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', color: '#ef4444' }}
              >
                <X size={16} />
                <span>{actionLoading === 'reject' ? 'Rejecting...' : 'Reject'}</span>
              </button>
            </>
          )}
          {canEdit && (
            <button
              onClick={() => onEdit(document)}
              disabled={actionLoading !== null}
              className="btn-secondary"
              style={
                isPending && canApprove
                  ? { minHeight: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }
                  : { flex: 1, minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }
              }
              title="Edit Document"
            >
              <Pencil size={16} />
              {!(isPending && canApprove) && <span>Edit Document</span>}
            </button>
          )}
        </div>
      )}
      <div className="owner-screen" style={{ paddingBottom: '1rem' }}>
        <DocumentPreview
          document={document}
          activeProfile={activeProfile}
          onClose={onClose}
        />
      </div>
    </div>
  );
};

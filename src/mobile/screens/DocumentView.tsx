import React from 'react';
import type { CompanyProfile, Document } from '../../types';
import { DocumentPreview } from '../../components/DocumentPreview';

interface DocumentViewProps {
  document: Document;
  activeProfile: CompanyProfile | null;
  onClose: () => void;
}

/**
 * Phase 1: view-only, reusing the exact same DocumentPreview component
 * the web app uses (same print/PDF layout, same WhatsApp share button -
 * now itself reusing the shared shareDocumentViaWhatsApp utility). No
 * Approve/Reject/Edit actions yet - those are Phase 2.
 */
export const DocumentView: React.FC<DocumentViewProps> = ({ document, activeProfile, onClose }) => {
  return (
    <div className="owner-shell">
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

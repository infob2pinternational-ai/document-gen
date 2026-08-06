import React from 'react';
import type { CompanyProfile, Document } from '../../types';
import { DocumentEditor } from '../../components/DocumentEditor';

interface DocumentEditProps {
  document: Document | null; // null when creating a brand-new document
  activeProfile: CompanyProfile | null;
  onClose: () => void;
  onRefreshDocs: () => void;
}

/**
 * Phase 3: reuses the exact same DocumentEditor component the web app
 * uses (same save/GST/draft/notification logic) instead of building a
 * second, mobile-specific editing form - no business logic duplicated,
 * only wrapped in the mobile shell chrome, same pattern as
 * DocumentView.tsx reusing DocumentPreview for Phase 1.
 */
export const DocumentEdit: React.FC<DocumentEditProps> = ({ document, activeProfile, onClose, onRefreshDocs }) => {
  return (
    <div className="owner-shell">
      <div className="owner-screen" style={{ paddingBottom: '1rem' }}>
        <DocumentEditor
          activeProfile={activeProfile}
          documentToEdit={document}
          onClose={onClose}
          onRefreshDocs={onRefreshDocs}
        />
      </div>
    </div>
  );
};

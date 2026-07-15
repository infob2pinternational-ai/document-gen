import React, { useState, useEffect } from 'react';
import { ComparisonService } from './ComparisonService';
import type { ComparisonConfig, ComparisonTemplate } from './ComparisonTypes';
import { Save, FolderOpen, Trash2, X } from 'lucide-react';

interface ComparisonTemplatesProps {
  companyId: string;
  currentConfig: ComparisonConfig;
  onLoadTemplate: (config: ComparisonConfig) => void;
  onClose: () => void;
}

export const ComparisonTemplates: React.FC<ComparisonTemplatesProps> = ({
  companyId,
  currentConfig,
  onLoadTemplate,
  onClose
}) => {
  const [templates, setTemplates] = useState<ComparisonTemplate[]>([]);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTemplates();
  }, [companyId]);

  const loadTemplates = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await ComparisonService.getComparisonTemplates(companyId);
      setTemplates(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load templates.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplateName.trim()) return;
    
    setLoading(true);
    setError(null);
    try {
      const newTpl = await ComparisonService.saveComparisonTemplate(companyId, newTemplateName.trim(), currentConfig);
      setTemplates([...templates, newTpl]);
      setNewTemplateName('');
      alert('Template saved successfully!');
    } catch (err: any) {
      setError(err.message || 'Failed to save template.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this template?')) return;
    
    setLoading(true);
    setError(null);
    try {
      await ComparisonService.deleteComparisonTemplate(companyId, id);
      setTemplates(templates.filter(t => t.id !== id));
    } catch (err: any) {
      setError(err.message || 'Failed to delete template.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }}>
      <div className="modal-content" style={{ maxWidth: '500px', width: '90%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FolderOpen size={20} style={{ color: 'var(--accent-primary)' }} />
            <span>Comparison Templates</span>
          </h3>
          <button onClick={onClose} className="btn-secondary" style={{ padding: '0.35rem', border: 'none', background: 'transparent' }}>
            <X size={18} />
          </button>
        </div>

        {error && (
          <div style={{ padding: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}

        {/* Save Template Form */}
        <form onSubmit={handleSaveTemplate} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
          <input
            type="text"
            placeholder="Template Name (e.g. Website Development)"
            value={newTemplateName}
            onChange={(e) => setNewTemplateName(e.target.value)}
            disabled={loading}
            style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-input)' }}
            required
          />
          <button type="submit" className="btn-primary" disabled={loading || !newTemplateName.trim()} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Save size={16} />
            <span>Save Current</span>
          </button>
        </form>

        {/* Templates List */}
        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
          <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Saved Layouts</h4>
          {templates.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-secondary)', fontSize: '0.875rem', border: '1px dashed var(--border-color)', borderRadius: '6px' }}>
              No templates saved yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {templates.map(tpl => (
                <div 
                  key={tpl.id} 
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.75rem',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px'
                  }}
                >
                  <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{tpl.name}</span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => {
                        onLoadTemplate(tpl.template_config);
                        onClose();
                      }}
                      className="btn-secondary"
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                      title="Load this template layout"
                    >
                      <FolderOpen size={12} />
                      <span>Load</span>
                    </button>
                    <button
                      onClick={() => handleDeleteTemplate(tpl.id)}
                      className="btn-secondary"
                      style={{ padding: '0.35rem', color: 'var(--accent-danger)' }}
                      title="Delete Template"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

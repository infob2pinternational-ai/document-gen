import { REQUIREMENT_OPTIONS, LEGACY_REQUIREMENT_LABELS, requirementLabel } from '../../services/fieldVisitService';

// Current options first, then legacy ones in their old order, so an old
// visit's requirements always display in the same stable order they always
// have - not whatever order they happen to be stored in.
const DISPLAY_ORDER = [...REQUIREMENT_OPTIONS.map(o => o.value), ...Object.keys(LEGACY_REQUIREMENT_LABELS)];

/**
 * requirements may contain keys from the current list, or legacy keys from
 * before it changed (see LEGACY_REQUIREMENT_LABELS) - a visit saved years ago
 * is not retyped just because the options changed. A truly unrecognised key
 * sorts to the end rather than the front.
 */
export const requirementText = (requirements: string[] = [], other?: string | null) =>
  [...requirements].sort((a, b) => {
    const indexOf = (key: string) => { const i = DISPLAY_ORDER.indexOf(key); return i === -1 ? Infinity : i; };
    return indexOf(a) - indexOf(b);
  }).map(key => (key === 'other' && other ? `Other: ${other}` : requirementLabel(key))).join(', ');
export const EVENT_LABEL: Record<string, string> = {
  submitted: 'Submitted', updated: 'Updated before review', resubmitted: 'Corrected and resubmitted', approved: 'Approved',
  rejected: 'Rejected', correction_requested: 'Sent back for correction', converted_new_lead: 'Converted to a new lead',
  converted_linked_lead: 'Linked to an existing lead'
};

// Classify a single provider response. Never infer delivery or generate an ID.
export function providerOutcome(response, body) {
  if (!response.ok) {
    return { success: false, outcome: response.status >= 500 || [408, 429].includes(response.status) ? 'uncertain' : 'rejected' };
  }
  if (body?.success === false || body?.error || body?.simulated) {
    return { success: false, outcome: 'rejected' };
  }
  const id = body?.messageId || body?.messages?.[0]?.id || body?.id || body?.data?.id;
  if (typeof id !== 'string' || !id.trim()) return { success: false, outcome: 'uncertain' };
  return { success: true, outcome: 'accepted', messageId: id };
}

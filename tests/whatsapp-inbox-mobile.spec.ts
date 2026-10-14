import { test, expect, type Page } from '@playwright/test';

import { setupApp, COMPANY_A } from './helpers/crm-test-helpers';
test.use({ serviceWorkers: 'block' });

const conversations = Array.from({ length: 80 }, (_, i) => ({
  id: `isolated-chat-${i}`, company_id: COMPANY_A.id, customer_name: `Synthetic Contact ${i}`,
  phone: '0000000000', last_message: 'Synthetic history', last_message_at: '2026-10-10T00:00:00Z',
  unread_count: 0, status: 'open', created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z',
}));
const history = Array.from({ length: 100 }, (_, i) => ({
  id: `synthetic-message-${i}`, conversation_id: conversations[0].id, company_id: COMPANY_A.id,
  sender_type: i % 2 ? 'staff' : 'customer', sender_name: 'Synthetic sender', text: `History line ${i}\nLong synthetic message for isolated layout testing.`,
  status: 'sent', timestamp: '2026-10-10T00:00:00Z', created_at: '2026-10-10T00:00:00Z',
}));

async function openInbox(page: Page) {
  // No production service or recipient is reachable from this suite.
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/services/apiAuth.ts')) {
      return route.fulfill({ contentType: 'application/javascript', body: 'export async function authenticatedHeaders() { return { "Content-Type": "application/json", Authorization: "Bearer isolated-test-only" }; }' });
    }
    if (!new URL(route.request().url()).hostname.match(/^(localhost|127\.0\.0\.1)$/)) return route.abort();
    return route.fallback();
  });
  await setupApp(page, { customers: [] });
  const backupReminder = page.getByRole('button', { name: 'Remind Me Later', exact: true });
  if (await backupReminder.isVisible()) await backupReminder.click();
  await page.evaluate(({ conversations, history }) => {
    localStorage.setItem('docgen_whatsapp_conversations', JSON.stringify(conversations));
    localStorage.setItem('docgen_whatsapp_messages', JSON.stringify({
      [conversations[0].id]: history,
      [conversations[1].id]: [{ ...history[0], id: 'second-history', conversation_id: conversations[1].id, text: 'Second conversation only' }],
    }));
  }, { conversations, history });
  if (page.viewportSize()!.width < 641) await page.getByRole('button', { name: 'Open Menu', exact: true }).click();
  await page.locator('aside.sidebar button').filter({ hasText: /^WhatsApp/ }).click();
  if (page.viewportSize()!.width < 768) await page.getByRole('button', { name: 'Open conversation with Synthetic Contact 0', exact: true }).click();
  await expect(page.getByTestId('whatsapp-composer')).toBeVisible();
  await expect(page.getByText('History line 99', { exact: false })).toBeVisible();
}

async function expectComposerInsideViewport(page: Page) {
  const box = await page.getByTestId('whatsapp-composer').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test('long list/history scroll independently; composer stays visible after polling', async ({ page }) => {
  await openInbox(page);
  await expectComposerInsideViewport(page);
  const feed = page.getByTestId('whatsapp-message-feed');
  expect(await feed.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await feed.evaluate(el => { el.scrollTop = 100; el.dispatchEvent(new Event('scroll')); });
  const position = await feed.evaluate(el => el.scrollTop);
  await page.waitForTimeout(5500); // Exercise the actual five-second poll regression.
  expect(await feed.evaluate(el => el.scrollTop)).toBeCloseTo(position, 0);
  await expectComposerInsideViewport(page);
  if (page.viewportSize()!.width >= 768) {
    const list = page.getByTestId('whatsapp-conversations');
    expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByRole('button', { name: 'Open conversation with Synthetic Contact 79', exact: true })).toBeInViewport();
  }
  await page.screenshot({ path: `test-results/whatsapp-${page.viewportSize()!.width}-composer.png` });
});

test('drafts survive switching conversations and history reload', async ({ page }) => {
  await openInbox(page);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Draft for first conversation');
  if (page.viewportSize()!.width < 768) await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Open conversation with Synthetic Contact 1', exact: true }).click();
  await expect(page.getByText('Second conversation only', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
  if (page.viewportSize()!.width < 768) await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Open conversation with Synthetic Contact 0', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Draft for first conversation');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expectComposerInsideViewport(page);
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Draft for first conversation');
});

test('Enter sends once, Shift+Enter adds newline, and failed send keeps draft', async ({ page }) => {
  let requests = 0;
  await openInbox(page);
  await page.route(/\/api\/whatsapp\?action=send-message/, async route => {
    requests++;
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic provider failure',safeToRetry:true }) });
  });
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Synthetic unsent draft');
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('Synthetic unsent draft\n');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: 'Sending…', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  expect(requests).toBe(1);
  await expect(input).toHaveValue('Synthetic unsent draft\n');
  await expect(page.getByText(/Check delivery before manually retrying/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Attach Quotation PDF', exact: true })).toHaveCount(0);
  await expect(page.getByText(/File uploads are not available in this release/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Attach PDF or image',exact:true})).toHaveCount(0);
});

test('accepted synthetic send clears draft and persists actual provider ID', async ({ page }) => {
  await openInbox(page);
  await page.route(/\/api\/whatsapp\?action=send-message/, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, messageId: 'wamid.synthetic-test' }),
  }));
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Synthetic accepted message');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('docgen_whatsapp_messages')!)[ 'isolated-chat-0' ].at(-1).wa_message_id)).toBe('wamid.synthetic-test');
});

test('short mobile viewport and context drawer retain composer after closing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 650 });
  await openInbox(page);
  await page.setViewportSize({ width: 390, height: 480 });
  await expectComposerInsideViewport(page);
  await page.getByRole('button', { name: 'Context', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close Context Drawer', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Context Drawer', exact: true }).click();
  await expectComposerInsideViewport(page);
});

test('offline state preserves a draft and blocks dispatch', async ({ page, context }) => {
  await openInbox(page);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Offline draft');
  await context.setOffline(true);
  await expect(page.getByText(/Offline — your draft is kept/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Offline draft');
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
});

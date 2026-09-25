import { test } from 'node:test';
import assert from 'node:assert/strict';
import bizyleadWebhookHandler from '../api/bizylead-webhook.js';

test('Bizylead credentials and configuration constants match verified account', () => {
  const BIZYLEAD_CONFIG = {
    phoneNumber: '+918139009034',
    phoneNumberId: '992427143955673',
    wabaId: '773200472496874',
    companyName: 'B2p International',
    webhookPath: '/api/bizylead-webhook'
  };

  assert.equal(BIZYLEAD_CONFIG.phoneNumber, '+918139009034');
  assert.equal(BIZYLEAD_CONFIG.phoneNumberId, '992427143955673');
  assert.equal(BIZYLEAD_CONFIG.wabaId, '773200472496874');
  assert.equal(BIZYLEAD_CONFIG.webhookPath, '/api/bizylead-webhook');
});

test('GET /api/bizylead-webhook returns 200 OK for registration pings', async () => {
  let statusCode = 0;
  let jsonResult = null;
  const headers = {};

  const req = { method: 'GET' };
  const res = {
    setHeader: (k, v) => { headers[k] = v; },
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { jsonResult = data; },
        end: () => {}
      };
    }
  };

  await bizyleadWebhookHandler(req, res);
  assert.equal(statusCode, 200);
  assert.equal(jsonResult.status, 'ok');
  assert.ok(jsonResult.service.includes('Bizylead'));
});

test('POST /api/bizylead-webhook parses Bizylead messages payload correctly', async () => {
  let statusCode = 0;
  let jsonResult = null;

  const req = {
    method: 'POST',
    body: {
      event: 'messages',
      messages: [
        {
          from: '918139009034',
          message: 'Hello, please send the tax invoice',
          name: 'Sarath John',
          id: 'bizy_msg_12345'
        }
      ]
    }
  };

  const res = {
    setHeader: () => {},
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { jsonResult = data; },
        end: () => {}
      };
    }
  };

  await bizyleadWebhookHandler(req, res);
  assert.equal(statusCode, 200);
  assert.equal(jsonResult.success, true);
  assert.equal(jsonResult.processedMessages, 1);
});

test('POST /api/bizylead-webhook handles status events', async () => {
  let statusCode = 0;
  let jsonResult = null;

  const req = {
    method: 'POST',
    body: {
      event: 'status',
      statuses: [
        {
          id: 'wamid.HBgLOTE4MTM5MDA5MDM0FQIAEhgg...',
          status: 'delivered'
        }
      ]
    }
  };

  const res = {
    setHeader: () => {},
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => { jsonResult = data; },
        end: () => {}
      };
    }
  };

  await bizyleadWebhookHandler(req, res);
  assert.equal(statusCode, 200);
  assert.equal(jsonResult.success, true);
  assert.equal(jsonResult.processedStatuses, 1);
});

test('OPTIONS /api/bizylead-webhook responds with CORS headers', async () => {
  let statusCode = 0;
  let ended = false;
  const headers = {};

  const req = { method: 'OPTIONS' };
  const res = {
    setHeader: (k, v) => { headers[k] = v; },
    status: (code) => {
      statusCode = code;
      return {
        end: () => { ended = true; }
      };
    }
  };

  await bizyleadWebhookHandler(req, res);
  assert.equal(statusCode, 200);
  assert.equal(ended, true);
  assert.equal(headers['Access-Control-Allow-Origin'], '*');
});

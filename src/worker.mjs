import { timingSafeEqual } from 'node:crypto';
import botModule from './bot.js';
import storeModule from './d1-store.js';
import telegramModule from './telegram-api.js';

const { createBot } = botModule;
const { D1Store } = storeModule;
const { createTelegramApi } = telegramModule;
const encoder = new TextEncoder();
const MAX_UPDATE_BYTES = 256 * 1024;

function authorized(actual, expected) {
  if (!actual || !expected) return false;
  const a = encoder.encode(actual);
  const b = encoder.encode(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readUpdate(request) {
  if (!request.body) throw new Error('Empty body');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_UPDATE_BYTES) {
      await reader.cancel();
      throw new Error('Update too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') {
      try {
        await env.DB.prepare('SELECT 1 FROM users LIMIT 1').first();
        return Response.json({ ok: true, configured: Boolean(env.BOT_TOKEN && env.ADMIN_ID && env.WEBHOOK_SECRET) });
      } catch {
        return Response.json({ ok: false }, { status: 503 });
      }
    }
    if (path !== '/telegram') return new Response('Not found', { status: 404 });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    if (!env.WEBHOOK_SECRET || !env.BOT_TOKEN) return new Response('Not configured', { status: 503 });
    if (!authorized(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), env.WEBHOOK_SECRET)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return new Response('Expected JSON', { status: 415 });
    }
    let update;
    try { update = await readUpdate(request); }
    catch { return new Response('Invalid update', { status: 400 }); }
    if (!Number.isSafeInteger(update?.update_id) || update.update_id < 0) return new Response('Invalid update', { status: 400 });
    const store = new D1Store(env.DB);
    let claim;
    try {
      claim = await store.claimUpdate(update.update_id);
      if (claim.done) return new Response('OK');
      if (!claim.token) return new Response('Retry later', { status: 503, headers: { 'Retry-After': '5' } });
      const { bot } = createBot(env, store, { callApi: createTelegramApi(env.BOT_TOKEN) });
      await bot.handleUpdate(update);
      await store.finishUpdate(update.update_id, claim.token);
      return new Response('OK');
    } catch (error) {
      const code = error?.response?.error_code;
      // An old message may belong to someone who blocked the bot, or refer to
      // a message Telegram can no longer edit. Retrying cannot fix a 4xx and
      // would block later updates. Rate limits and server/network errors retry.
      if (claim?.token && code >= 400 && code < 500 && code !== 429) {
        console.warn(JSON.stringify({ event: 'telegram_update_rejected', update_id: update.update_id, code }));
        await store.finishUpdate(update.update_id, claim.token);
        return new Response('OK');
      }
      console.error(JSON.stringify({ event: 'telegram_update_failed', update_id: update.update_id,
        code: code || null, error: error?.name || 'unknown',
        operation: /^Telegram [A-Za-z]+/.exec(error?.message || '')?.[0] || null }));
      if (claim?.token) await store.releaseUpdate(update.update_id, claim.token);
      return new Response('Retry later', { status: 503 });
    }
  },
  async scheduled(_event, env) {
    await new D1Store(env.DB).cleanupUpdates();
  }
};

const fs = require('node:fs');
const { createTelegramApi } = require('../src/telegram-api');

async function configureWebhook(url, values, checkOnly = false) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.pathname !== '/telegram' || target.search || target.hash || target.username || target.password) {
    throw new Error('Use an HTTPS URL ending in /telegram, without credentials, query or fragment');
  }
  if (!values.BOT_TOKEN || !values.WEBHOOK_SECRET) throw new Error('Prepare secrets first');
  const callApi = createTelegramApi(values.BOT_TOKEN);
  const me = await callApi('getMe');
  const old = await callApi('getWebhookInfo');
  if (!checkOnly) {
    const health = await fetch(new URL('/health', target), { signal: AbortSignal.timeout(15000) });
    if (!health.ok || !(await health.json()).configured) throw new Error('Worker is not configured');
    const channels = new Set([values.CHANNEL_ID, values.CHANNEL_CS16_ID, values.CHANNEL_DOTA2_ID].filter(Boolean));
    for (const chat_id of channels) {
      const member = await callApi('getChatMember', { chat_id, user_id: me.id });
      if (member.status !== 'creator' && !(member.status === 'administrator' && member.can_invite_users)) {
        throw new Error('Bot needs permission to invite users');
      }
    }
    // Retain queued Telegram updates during migration; never drop pending updates.
    await callApi('setWebhook', { url: target.href, secret_token: values.WEBHOOK_SECRET,
      allowed_updates: ['message','callback_query'], max_connections: 1, drop_pending_updates: false });
  }
  const current = await callApi('getWebhookInfo');
  return { bot: me.username, previousUrl: old.url, url: current.url,
    pendingUpdates: current.pending_update_count, hasDeliveryError: Boolean(current.last_error_message),
    configured: current.url === target.href };
}
if (require.main === module) {
  (async () => {
    const config = JSON.parse(fs.readFileSync('wrangler.jsonc','utf8').replace(/^\uFEFF/, ''));
    const values = { ...config.vars, ...JSON.parse(fs.readFileSync('.wrangler/secrets.private.json','utf8')) };
    console.log(JSON.stringify(await configureWebhook(process.argv[2], values, process.argv.includes('--check')), null, 2));
  })().catch(() => { console.error('Webhook configuration failed. Check bot secrets, Worker health and Telegram availability.'); process.exitCode = 1; });
}
module.exports = { configureWebhook };

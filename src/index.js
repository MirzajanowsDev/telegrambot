require('dotenv').config();
const path = require('node:path');
const { createBot } = require('./bot');
const { JsonStore } = require('./json-store');
const { bot } = createBot(process.env, new JsonStore(process.env.DATA_PATH || path.join(__dirname, '..', 'data.json')));
bot.catch(err => console.error('BOT ERROR:', err.message));
bot.launch(() => console.log('✅ Generals Access Bot запущен')).catch(() => {
  console.error('FATAL: bot.launch() failed');
  process.exit(1);
});
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

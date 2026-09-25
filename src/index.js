require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const CHANNEL_ID = process.env.CHANNEL_ID;
const INVITE_EXPIRE_MINUTES = Number(process.env.INVITE_EXPIRE_MINUTES || 60);

const methods = {
  ru: {
    country: '🇷🇺 Россия',
    price: process.env.PRICE_RU || '700 ₽',
    requisites: process.env.PAYMENT_RU || 'Реквизиты не указаны'
  },
  uz: {
    country: "🇺🇿 O'zbekiston",
    price: process.env.PRICE_UZ || '60000 сум',
    requisites: process.env.PAYMENT_UZ || "Rekvizitlar ko'rsatilmagan"
  },
  kg: {
    country: '🇰🇬 Кыргызстан',
    price: process.env.PRICE_KG || '500 сом',
    requisites: process.env.PAYMENT_KG || 'Реквизиттер көрсөтүлгөн эмес'
  }
};

if (!BOT_TOKEN || BOT_TOKEN.includes('PASTE_')) throw new Error('Укажите BOT_TOKEN в .env');
if (!ADMIN_ID) throw new Error('Укажите ADMIN_ID в .env');
if (!CHANNEL_ID) throw new Error('Укажите CHANNEL_ID в .env');

const bot = new Telegraf(BOT_TOKEN);
const DB_PATH = path.join(__dirname, '..', 'data.json');

async function safeAnswer(ctx, text) {
  try {
    await ctx.answerCbQuery(text);
  } catch (err) {
    const code = err && err.response && err.response.error_code;
    // ignore common harmless callback errors
    if (code === 400 || code === 403) return;
    console.error('CB ERROR:', err);
  }
}

function loadDb() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { users: {}, payments: {} }; }
}
function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}
function getUser(id) {
  const db = loadDb();
  return db.users[String(id)] || {};
}
function setUser(id, patch) {
  const db = loadDb();
  db.users[String(id)] = { ...(db.users[String(id)] || {}), ...patch };
  saveDb(db);
}
function tr(lang, ru, uz) {
  return lang === 'uz' ? uz : ru;
}

function languageKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🇷🇺 Русский', 'lang_ru'),
      Markup.button.callback("🇺🇿 O'zbekcha", 'lang_uz')
    ]
  ]);
}

function mainKeyboard(lang) {
  const supportLink = ADMIN_USERNAME ? `https://t.me/${ADMIN_USERNAME}` : `tg://user?id=${ADMIN_ID}`;
  return Markup.inlineKeyboard([
    [Markup.button.callback(tr(lang, '💳 Оплатить доступ', "💳 To'lov qilish"), 'choose_payment')],
    [Markup.button.callback(tr(lang, '📸 Отправить чек', '📸 Chek yuborish'), 'send_receipt')],
    [Markup.button.callback(tr(lang, '✅ Статус оплаты', "✅ To'lov holati"), 'status')],
    [Markup.button.callback(tr(lang, '🌐 Сменить язык', "🌐 Tilni o'zgartirish"), 'language')],
    [Markup.button.url(tr(lang, '🆘 Поддержка', "🆘 Yordam"), supportLink)]
  ]);
}

function paymentKeyboard(lang) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🇷🇺 700 ₽', 'pay_ru')],
    [Markup.button.callback("🇺🇿 60 000 сум", 'pay_uz')],
    [Markup.button.callback('🇰🇬 500 сом', 'pay_kg')],
    [Markup.button.callback(tr(lang, '⬅️ Назад', '⬅️ Orqaga'), 'home')]
  ]);
}

bot.start(async (ctx) => {
  setUser(ctx.from.id, {
    username: ctx.from.username || '',
    first_name: ctx.from.first_name || '',
    last_seen: new Date().toISOString()
  });
  await ctx.reply('🎮 GENERALS ANDROID\n\nВыберите язык / Tilni tanlang:', languageKeyboard());
});

bot.action('language', async (ctx) => {
  await safeAnswer(ctx);
  await ctx.editMessageText('Выберите язык / Tilni tanlang:', languageKeyboard());
});

bot.action(/^lang_(ru|uz)$/, async (ctx) => {
  await safeAnswer(ctx);
  const lang = ctx.match[1];
  setUser(ctx.from.id, { lang });
  const text = tr(
    lang,
    '🎮 *GENERALS ДЛЯ ANDROID*\n\nВыберите удобный способ оплаты и после оплаты отправьте чек.\n\n✅ После проверки администратором бот сам выдаст доступ в закрытый канал.',
    "🎮 *GENERALS ANDROID UCHUN*\n\nQulay to'lov turini tanlang va to'lovdan keyin chekni yuboring.\n\n✅ Administrator tekshirganidan so'ng bot yopiq kanalga kirish havolasini beradi."
  );
  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...mainKeyboard(lang) });
});

bot.action('home', async (ctx) => {
  await safeAnswer(ctx);
  const lang = getUser(ctx.from.id).lang || 'ru';
  await ctx.editMessageText(
    tr(lang, '🎮 GENERALS ДЛЯ ANDROID', '🎮 GENERALS ANDROID UCHUN'),
    mainKeyboard(lang)
  );
});

bot.action('choose_payment', async (ctx) => {
  await safeAnswer(ctx);
  const lang = getUser(ctx.from.id).lang || 'ru';
  await ctx.reply(
    tr(
      lang,
      '💳 Выберите страну / валюту для оплаты:',
      "💳 To'lov uchun davlat / valyutani tanlang:"
    ),
    paymentKeyboard(lang)
  );
});

bot.action(/^pay_(ru|uz|kg)$/, async (ctx) => {
  await safeAnswer(ctx);
  const methodCode = ctx.match[1];
  const method = methods[methodCode];
  const lang = getUser(ctx.from.id).lang || 'ru';

  setUser(ctx.from.id, {
    payment_method: methodCode,
    waiting_receipt: false
  });

  await ctx.reply(
    tr(
      lang,
      `💳 *Оплата доступа*\n\n${method.country}\nСумма: *${method.price}*\n\nРеквизиты:\n${method.requisites}\n\nПосле оплаты нажмите «📸 Отправить чек».`,
      `💳 *Kirish uchun to'lov*\n\n${method.country}\nSumma: *${method.price}*\n\nRekvizitlar:\n${method.requisites}\n\nTo'lovdan so'ng «📸 Chek yuborish» tugmasini bosing.`
    ),
    { parse_mode: 'Markdown', ...mainKeyboard(lang) }
  );
});

bot.action('send_receipt', async (ctx) => {
  await safeAnswer(ctx);
  const user = getUser(ctx.from.id);
  const lang = user.lang || 'ru';

  if (!user.payment_method || !methods[user.payment_method]) {
    return ctx.reply(
      tr(lang, 'Сначала выберите способ оплаты.', "Avval to'lov usulini tanlang."),
      paymentKeyboard(lang)
    );
  }

  setUser(ctx.from.id, { waiting_receipt: true });
  const method = methods[user.payment_method];

  await ctx.reply(
    tr(
      lang,
      `📸 Отправьте фото или PDF чека.\n\nВыбранная оплата: ${method.country} — ${method.price}`,
      `📸 Chek rasmi yoki PDF faylini yuboring.\n\nTanlangan to'lov: ${method.country} — ${method.price}`
    )
  );
});

async function acceptReceipt(ctx) {
  const user = getUser(ctx.from.id);
  const lang = user.lang || 'ru';

  if (!user.waiting_receipt || !user.payment_method) {
    return ctx.reply(
      tr(lang, 'Сначала выберите оплату и нажмите «📸 Отправить чек».', "Avval to'lovni tanlang va «📸 Chek yuborish» tugmasini bosing."),
      mainKeyboard(lang)
    );
  }

  const method = methods[user.payment_method];
  const db = loadDb();
  const paymentId = `${Date.now()}_${ctx.from.id}`;

  db.payments[paymentId] = {
    id: paymentId,
    user_id: ctx.from.id,
    username: ctx.from.username || '',
    first_name: ctx.from.first_name || '',
    lang,
    payment_method: user.payment_method,
    price: method.price,
    country: method.country,
    status: 'pending',
    created_at: new Date().toISOString(),
    source_chat_id: ctx.chat.id,
    source_message_id: ctx.message.message_id
  };
  db.users[String(ctx.from.id)] = {
    ...(db.users[String(ctx.from.id)] || {}),
    waiting_receipt: false
  };
  saveDb(db);

  await ctx.telegram.forwardMessage(ADMIN_ID, ctx.chat.id, ctx.message.message_id);
  const uname = ctx.from.username ? `@${ctx.from.username}` : 'без username';
  const profileLink = ctx.from.username ? `https://t.me/${ctx.from.username}` : `tg://user?id=${ctx.from.id}`;
  const safeFirstName = (ctx.from.first_name || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  await ctx.telegram.sendMessage(
    ADMIN_ID,
    `🧾 Новый чек\n\n👤 ${safeFirstName} (${uname})\n🔗 <a href="${profileLink}">Профиль</a>\n🆔 ${ctx.from.id}\n🌍 ${method.country}\n💳 ${method.price}\n\nПодтвердить оплату?`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Подтвердить', `approve:${paymentId}`),
        Markup.button.callback('❌ Отклонить', `reject:${paymentId}`)
      ]
    ]) }
  );

  await ctx.reply(
    tr(
      lang,
      '✅ Чек получен!\n\nОжидайте проверки. После подтверждения бот автоматически отправит ссылку в закрытый канал.',
      "✅ Chek qabul qilindi!\n\nTekshiruvni kuting. Tasdiqlangach bot yopiq kanal havolasini avtomatik yuboradi."
    ),
    mainKeyboard(lang)
  );
}

bot.on('photo', acceptReceipt);

bot.on('document', async (ctx) => {
  const mime = ctx.message.document?.mime_type || '';
  if (mime.startsWith('image/') || mime === 'application/pdf') return acceptReceipt(ctx);

  const lang = getUser(ctx.from.id).lang || 'ru';
  await ctx.reply(tr(lang, 'Отправьте фото или PDF чека.', 'Chek rasmi yoki PDF faylini yuboring.'));
});

bot.action(/^approve:(.+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return safeAnswer(ctx, 'Нет доступа');
  await safeAnswer(ctx, 'Подтверждаю…');

  const paymentId = ctx.match[1];
  const db = loadDb();
  const payment = db.payments[paymentId];

  if (!payment) return ctx.reply('Платёж не найден.');
  if (payment.status === 'approved') return ctx.reply('Уже подтверждено.');

  const expireDate = Math.floor(Date.now() / 1000) + INVITE_EXPIRE_MINUTES * 60;

  try {
    const invite = await ctx.telegram.createChatInviteLink(CHANNEL_ID, {
      name: `pay_${payment.user_id}`,
      expire_date: expireDate,
      member_limit: 1
    });

    payment.status = 'approved';
    payment.approved_at = new Date().toISOString();
    payment.invite_link = invite.invite_link;
    saveDb(db);

    const lang = payment.lang || 'ru';

    await ctx.telegram.sendMessage(
      payment.user_id,
      tr(
        lang,
        `✅ *Оплата подтверждена!*\n\n${payment.country} — ${payment.price}\n\nНажмите кнопку ниже, чтобы войти в закрытый канал.\n\n⚠️ Ссылка одноразовая и действует ${INVITE_EXPIRE_MINUTES} минут.`,
        `✅ *To'lov tasdiqlandi!*\n\n${payment.country} — ${payment.price}\n\nYopiq kanalga kirish uchun pastdagi tugmani bosing.\n\n⚠️ Havola bir martalik va ${INVITE_EXPIRE_MINUTES} daqiqa amal qiladi.`
      ),
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url(tr(lang, '🔐 Войти в канал', '🔐 Kanalga kirish'), invite.invite_link)]
        ])
      }
    );

    await ctx.editMessageText(
      `✅ ОПЛАТА ПОДТВЕРЖДЕНА\n\nUser ID: ${payment.user_id}\n${payment.country} — ${payment.price}\nСсылка отправлена пользователю.`
    );
  } catch (err) {
    console.error(err);
    await ctx.reply('❗ Не удалось создать ссылку. Проверьте права бота в закрытом канале.');
  }
});

bot.action(/^reject:(.+)$/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return safeAnswer(ctx, 'Нет доступа');
  await safeAnswer(ctx, 'Отклонено');

  const paymentId = ctx.match[1];
  const db = loadDb();
  const payment = db.payments[paymentId];

  if (!payment) return ctx.reply('Платёж не найден.');

  payment.status = 'rejected';
  payment.rejected_at = new Date().toISOString();
  saveDb(db);

  const lang = payment.lang || 'ru';
  await ctx.telegram.sendMessage(
    payment.user_id,
    tr(
      lang,
      '❌ Оплата не подтверждена.\n\nПроверьте чек и реквизиты. Если была ошибка, отправьте чек повторно.',
      "❌ To'lov tasdiqlanmadi.\n\nChek va rekvizitlarni tekshiring. Xatolik bo'lsa, chekni qayta yuboring."
    ),
    mainKeyboard(lang)
  );

  await ctx.editMessageText(
    `❌ ОПЛАТА ОТКЛОНЕНА\n\nUser ID: ${payment.user_id}\n${payment.country} — ${payment.price}`
  );
});

bot.action('status', async (ctx) => {
  await safeAnswer(ctx);
  const user = getUser(ctx.from.id);
  const lang = user.lang || 'ru';
  const db = loadDb();

  const payments = Object.values(db.payments)
    .filter(p => p.user_id === ctx.from.id)
    .sort((a,b) => b.created_at.localeCompare(a.created_at));

  if (!payments.length) {
    return ctx.reply(
      tr(lang, 'У вас пока нет отправленных чеков.', 'Siz hali chek yubormagansiz.'),
      mainKeyboard(lang)
    );
  }

  const p = payments[0];
  const statusMap = {
    pending: tr(lang, '⏳ На проверке', '⏳ Tekshiruvda'),
    approved: tr(lang, '✅ Подтверждено', '✅ Tasdiqlangan'),
    rejected: tr(lang, '❌ Отклонено', '❌ Rad etilgan')
  };

  await ctx.reply(
    `${statusMap[p.status] || p.status}\n${p.country} — ${p.price}`,
    mainKeyboard(lang)
  );
});

bot.catch(err => console.error('BOT ERROR:', err));

bot.launch().then(() => console.log('✅ Generals Access Bot v2 запущен'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// file: index.js
const { botName, photoURL } = require('./setting'); 
const { EduMailBot } = require('./edumailfree.js'); 
const Session = require('./models/Session');

let bot;

async function getUserSession(chatId) {
  let session = await Session.findOne({ chatId });
  if (!session) {
      session = new Session({ chatId });
      await session.save();
  }
  return session;
}

async function sendStartMenu(chatId) {
  const caption = `Selamat datang di *${botName}*.\n\nBot siap digunakan. Silakan pilih menu di bawah ini:`;
  // WAJIB AWAIT: Agar Vercel menunggu pesan terkirim
  await bot.sendPhoto(chatId, photoURL, {
    caption, parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '📧 Buat Temp Mail', callback_data: 'action_list_domain' }]] }
  });
}

function setBotInstance(botInstance) {
  bot = botInstance; 

  bot.onText(/^\/start$/, async (msg) => {
    const chatId = msg.chat.id;
    let session = await getUserSession(chatId);
    
    let mailBot = new EduMailBot(session);
    await mailBot.stop(); // Reset
    
    await sendStartMenu(chatId);
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    let session = await getUserSession(chatId);

    try {
        // Matikan loading di tombol Telegram terlebih dahulu
        await bot.answerCallbackQuery(query.id); 

        if (data === 'action_list_domain') {
          // WAJIB AWAIT
          await bot.editMessageText("⏳ _Memuat daftar domain aktif..._", { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
          
          let tempBot = new EduMailBot(session);
          let domains = await tempBot.getAvailableDomains();
          
          if (domains.length === 0) {
              // Jika muncul error ini di Telegram, artinya FIX Vercel diblokir Cloudflare
              return await bot.editMessageText("❌ Gagal memuat domain.\n\n_Penyebab: Sistem EduMailFree memblokir IP server Vercel (Cloudflare Access Denied)._", { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
          }

          let keyboard = domains.map(d => [{ text: `🌐 ${d}`, callback_data: `dom_${d}` }]);
          await bot.editMessageText("Pilih domain untuk email Anda:", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard } });
        }

        else if (data.startsWith('dom_')) {
          session.selectedDomain = data.replace('dom_', '');
          await session.save();
          await bot.editMessageText(`Anda memilih domain: *${session.selectedDomain}*\n\nPilih metode:`, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '✍️ Manual (Ketik Nama)', callback_data: 'type_manual' }], [{ text: '🎲 Otomatis (Random)', callback_data: 'type_auto' }]] }
          });
        }

        else if (data === 'type_manual') {
          session.step = 'WAITING_USERNAME';
          await session.save();
          await bot.editMessageText("Silakan ketik nama username:\n_Catatan: Tanpa @domain_", { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        }

        else if (data === 'type_auto') {
          let randomName = Math.random().toString(36).substring(2, 10) + Math.floor(Math.random() * 100);
          await bot.editMessageText("⏳ _Memproses pembuatan email..._", { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
          await startEmailCreation(chatId, messageId, randomName, session.selectedDomain, session);
        }

        else if (data === 'action_check_inbox') {
          let mailBot = new EduMailBot(session);
          let check = await mailBot.checkInboxManual();

          let baseKeyboard = { inline_keyboard: [
              [{ text: '🔄 Cek Pesan Masuk', callback_data: 'action_check_inbox' }],
              [{ text: '🛑 Stop / Hapus Gmail', callback_data: 'action_stop_mail' }]
          ]};

          if (check.status === 'empty') {
              await bot.sendMessage(chatId, `📭 _Belum ada pesan baru di_ \`${session.activeEmail}\``, { parse_mode: 'Markdown' });
          } else if (check.status === 'new') {
              for (let mail of check.data) {
                  let otpText = mail.otp ? `🔑 *OTP:* \`${mail.otp}\`\n\n` : '';
                  let newContent = `📥 *EMAIL MASUK!*\n━━━━━━━━━━━━━━━━━━\n📧 *Email:* \`${session.activeEmail}\`\n👤 *Dari:* ${mail.sender_name} (${mail.sender_email})\n━━━━━━━━━━━━━━━━━━\n${otpText}📝 *Isi Pesan:*\n\`${mail.content}\`\n━━━━━━━━━━━━━━━━━━`;
                  await bot.sendMessage(chatId, newContent, { parse_mode: 'Markdown', reply_markup: baseKeyboard });
              }
          } else {
              await bot.sendMessage(chatId, `❌ Error: ${check.msg}`);
          }
        }

        else if (data === 'action_stop_mail') {
          let mailBot = new EduMailBot(session);
          await mailBot.stop();
          await bot.editMessageText("🛑 Sesi email dihentikan.", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '➕ Buat Mail Baru', callback_data: 'action_list_domain' }]] } });
        }
    } catch (e) {
        console.error("Callback Error:", e);
    }
  });

  bot.on('message', async msg => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    let session = await getUserSession(chatId);

    if (session.step === 'WAITING_USERNAME') {
      const username = msg.text.replace(/[^a-zA-Z0-9]/g, ''); 
      session.step = 'IDLE'; 
      await session.save();
      
      let waitMsg = await bot.sendMessage(chatId, "⏳ _Memproses pembuatan email..._", { parse_mode: 'Markdown' });
      await startEmailCreation(chatId, waitMsg.message_id, username, session.selectedDomain, session);
      return;
    }
  });
}

async function startEmailCreation(chatId, messageId, username, domain, session) {
  let mailBot = new EduMailBot(session);
  await mailBot.stop(); // Bersihkan sesi lama jika ada
  
  let result = await mailBot.generateEmail(username, domain);
  
  if (!result.success) {
    return await bot.editMessageText(`❌ Gagal: ${result.error}`, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: '🔄 Coba Lagi', callback_data: 'action_list_domain' }]] } });
  }

  const activeText = `✅ *Email Berhasil Dibuat!*\n📧 \`${result.email}\`\n\n_Silakan gunakan tombol di bawah untuk mengecek kotak masuk._`;
  await bot.editMessageText(activeText, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
      [{ text: '🔄 Cek Pesan Masuk', callback_data: 'action_check_inbox' }],
      [{ text: '🛑 Stop / Hapus Gmail', callback_data: 'action_stop_mail' }]
  ]}});
}

module.exports = { setBotInstance };

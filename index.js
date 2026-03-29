// file: index.js
const { botName, photoURL } = require('./setting'); 
const { EduMailBot } = require('./edumailfree.js'); 
const Session = require('./models/Session');

async function getUserSession(chatId) {
  let session = await Session.findOne({ chatId });
  if (!session) {
      session = new Session({ chatId });
      await session.save();
  }
  return session;
}

async function handleUpdate(update, bot) {
    try {
        if (update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            const text = msg.text ? msg.text.trim() : '';

            if (text === '/start') {
                let session = await getUserSession(chatId);
                let mailBot = new EduMailBot(session);
                await mailBot.stop(); 
                
                const caption = `Selamat datang di *${botName}*.\n\nBot siap digunakan. Silakan pilih menu di bawah ini:`;
                await bot.sendPhoto(chatId, photoURL, {
                    caption, parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '📧 Buat Temp Mail', callback_data: 'action_list_domain' }]] }
                });
                return;
            }

            if (!text.startsWith('/')) {
                let session = await getUserSession(chatId);
                if (session.step === 'WAITING_USERNAME') {
                    const username = text.replace(/[^a-zA-Z0-9]/g, ''); 
                    session.step = 'IDLE'; 
                    await session.save();
                    
                    let waitMsg = await bot.sendMessage(chatId, "⏳ _Memproses pembuatan email..._", { parse_mode: 'Markdown' });
                    await startEmailCreation(bot, chatId, waitMsg.message_id, username, session.selectedDomain, session);
                }
            }
        } 
        
        else if (update.callback_query) {
            const query = update.callback_query;
            const chatId = query.message.chat.id;
            const messageId = query.message.message_id;
            const data = query.data;
            
            let session = await getUserSession(chatId);
            
            await bot.answerCallbackQuery(query.id).catch(()=>{});

            if (data === 'action_list_domain') {
                // PERBAIKAN: Hapus pesan sebelumnya (foto) karena tidak bisa diedit menjadi teks
                await bot.deleteMessage(chatId, messageId).catch(()=>{});
                
                // Kirim pesan teks loading yang baru
                let sentMsg = await bot.sendMessage(chatId, "⏳ _Memuat daftar domain aktif..._", { parse_mode: 'Markdown' });
                
                let tempBot = new EduMailBot(session);
                let domains = await tempBot.getAvailableDomains();
                
                if (domains.length === 0) {
                    return await bot.editMessageText("❌ Gagal memuat domain.\n\n_Penyebab: Sistem EduMailFree memblokir IP server Vercel (Cloudflare Access Denied)._", { chat_id: chatId, message_id: sentMsg.message_id, parse_mode: 'Markdown' });
                }

                let keyboard = domains.map(d => [{ text: `🌐 ${d}`, callback_data: `dom_${d}` }]);
                await bot.editMessageText("Pilih domain untuk email Anda:", { chat_id: chatId, message_id: sentMsg.message_id, reply_markup: { inline_keyboard: keyboard } });
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
                await startEmailCreation(bot, chatId, messageId, randomName, session.selectedDomain, session);
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
                
                // Menghapus pesan sebelumnya dan mengirim menu utama
                await bot.deleteMessage(chatId, messageId).catch(()=>{});
                
                const caption = `🛑 Sesi email dihentikan.\n\nSelamat datang di *${botName}*.\nBot siap digunakan. Silakan pilih menu di bawah ini:`;
                await bot.sendPhoto(chatId, photoURL, {
                    caption, parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '📧 Buat Temp Mail', callback_data: 'action_list_domain' }]] }
                });
            }
        }
    } catch (error) {
        console.error("Handle Update Error:", error);
    }
}

async function startEmailCreation(bot, chatId, messageId, username, domain, session) {
  let mailBot = new EduMailBot(session);
  await mailBot.stop(); 
  
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

module.exports = { handleUpdate };

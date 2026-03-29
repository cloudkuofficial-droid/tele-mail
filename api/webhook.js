// file: api/webhook.js
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const { token, mongoURI } = require('../setting');
const { setBotInstance } = require('../index');

let isDbConnected = false;
const connectDb = async () => {
    if (isDbConnected) return;
    await mongoose.connect(mongoURI);
    isDbConnected = true;
};

// BOT TANPA POLLING (Mode Webhook)
const bot = new TelegramBot(token); 
setBotInstance(bot);

module.exports = async (req, res) => {
    try {
        await connectDb(); // Sambungkan ke MongoDB
        
        if (req.body) {
            bot.processUpdate(req.body); // Serahkan pesan ke index.js
            
            // TRIK VERCEL: Tahan serverless agar tidak langsung mati selama 3 detik
            // Ini memberi waktu bagi bot.on() untuk selesai mengirim pesan ke Telegram
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        res.status(200).send('OK');
    } catch (error) {
        console.error("Webhook Error:", error);
        res.status(500).send('Error');
    }
};

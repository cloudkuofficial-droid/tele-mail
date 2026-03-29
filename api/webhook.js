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
        await connectDb(); 
        
        if (req.body) {
            bot.processUpdate(req.body); 
            
            // PERUBAHAN DI SINI: Naikkan menjadi 8 detik (8000 ms)
            // Agar bot punya cukup waktu untuk menarik data domain dari EduMail
            await new Promise(resolve => setTimeout(resolve, 8000));
        }
        
        res.status(200).send('OK');
    } catch (error) {
        console.error("Webhook Error:", error);
        res.status(500).send('Error');
    }
};

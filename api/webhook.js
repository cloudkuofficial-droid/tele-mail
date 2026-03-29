// file: api/webhook.js
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const { token, mongoURI } = require('../setting');
const { handleUpdate } = require('../index'); // <-- Hanya memanggil handleUpdate

let isDbConnected = false;
const connectDb = async () => {
    if (isDbConnected) return;
    await mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 5000 });
    isDbConnected = true;
};

// Inisiasi bot tanpa polling
const bot = new TelegramBot(token); 

module.exports = async (req, res) => {
    try {
        await connectDb(); 
        
        if (req.body) {
            // TUNGGU sampai seluruh logika bot di index.js selesai
            await handleUpdate(req.body, bot); 
        }
        
        // Vercel baru boleh mati setelah semuanya selesai
        res.status(200).send('OK');
    } catch (error) {
        console.error("Webhook Error:", error);
        res.status(200).send('OK'); 
    }
};

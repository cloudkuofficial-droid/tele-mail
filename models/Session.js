// file: models/Session.js
const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    chatId: { type: Number, required: true, unique: true },
    step: { type: String, default: 'IDLE' },
    selectedDomain: { type: String, default: null },
    activeEmail: { type: String, default: null },
    csrfToken: { type: String, default: null },
    currentSnapshot: { type: String, default: null },
    readEmails: { type: [String], default: [] },
    cookies: { type: Object, default: null } // Menyimpan sesi EduMail
});

module.exports = mongoose.model('Session', sessionSchema);

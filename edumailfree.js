// file: edumailfree.js
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const he = require('he');

class EduMailBot {
    constructor(sessionDb) {
        this.sessionDb = sessionDb;
        this.chatId = sessionDb.chatId;
        
        if (sessionDb.cookies && Object.keys(sessionDb.cookies).length > 0) {
            this.jar = CookieJar.deserializeSync(sessionDb.cookies);
        } else {
            this.jar = new CookieJar();
        }

        this.client = wrapper(axios.create({ 
            jar: this.jar, 
            withCredentials: true,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json, text/html',
                'origin': 'https://edumailfree.com',
                'referer': 'https://edumailfree.com/'
            }
        }));
    }

    async saveState() {
        this.sessionDb.cookies = this.jar.serializeSync();
        await this.sessionDb.save();
    }

    findSnapshotByName(html, componentName) {
        const matches = [...html.matchAll(/wire:snapshot="([^"]+)"/g)];
        for (const match of matches) {
            const decoded = he.decode(match[1]);
            if (decoded.includes(`"name":"${componentName}"`)) return decoded;
        }
        return null;
    }

    async getAvailableDomains() {
        try {
            let res = await this.client.get('https://edumailfree.com/');
            let rawSnapshot = this.findSnapshotByName(res.data, 'frontend.actions');
            if (rawSnapshot) {
                return JSON.parse(rawSnapshot).data.domains[0]; 
            }
        } catch (err) {}
        return [];
    }

    async generateEmail(username, targetDomain) {
        try {
            let res = await this.client.get('https://edumailfree.com/');
            let csrfMatch = res.data.match(/<meta name="csrf-token" content="(.*?)"/);
            let csrfToken = csrfMatch ? csrfMatch[1] : null;
            let rawSnapshot = this.findSnapshotByName(res.data, 'frontend.actions');

            if (!csrfToken || !rawSnapshot) throw new Error("Gagal mengambil token awal.");

            let setDomainPayload = { _token: csrfToken, components: [{ snapshot: rawSnapshot, updates: {}, calls: [{ path: "", method: "setDomain", params: [targetDomain] }] }] };
            let domainRes = await this.client.post('https://edumailfree.com/livewire/update', setDomainPayload, { headers: { 'x-livewire': 'true', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken } });
            
            let snapshotAfterDomain = domainRes.data.components[0].snapshot;
            let createPayload = { _token: csrfToken, components: [{ snapshot: snapshotAfterDomain, updates: { user: username }, calls: [{ path: "", method: "create", params: [] }] }] };
            let createRes = await this.client.post('https://edumailfree.com/livewire/update', createPayload, { headers: { 'x-livewire': 'true', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken } });

            let effects = createRes.data.components[0].effects;
            if (!effects || !effects.redirect || !effects.redirect.includes('mailbox')) throw new Error("Username terpakai.");

            let htmlMailbox = await this.client.get('https://edumailfree.com/mailbox');
            let inboxSnap = this.findSnapshotByName(htmlMailbox.data, 'frontend.app');

            this.sessionDb.activeEmail = `${username}@${targetDomain}`;
            this.sessionDb.csrfToken = csrfToken;
            this.sessionDb.currentSnapshot = inboxSnap;
            await this.saveState();

            return { success: true, email: this.sessionDb.activeEmail };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async checkInboxManual() {
        let { csrfToken, currentSnapshot, readEmails } = this.sessionDb;
        if (!csrfToken || !currentSnapshot) return { status: 'error', msg: 'Sesi tidak valid.' };

        try {
            let pollPayload = { _token: csrfToken, components: [{ snapshot: currentSnapshot, updates: {}, calls: [{ path: "", method: "__dispatch", params: ["fetchMessages", {}] }] }] };
            let pollRes = await this.client.post('https://edumailfree.com/livewire/update', pollPayload, { headers: { 'x-livewire': 'true', 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken } });

            currentSnapshot = pollRes.data.components[0].snapshot; 
            this.sessionDb.currentSnapshot = currentSnapshot;
            
            let messagesArray = JSON.parse(currentSnapshot)?.data?.messages;
            let newMails = [];

            if (messagesArray && messagesArray[0] && messagesArray[0][0]) {
                let mailItems = messagesArray[0][0];
                for (let mail of mailItems) {
                    if (mail && mail.id && !readEmails.includes(mail.id)) {
                        
                        // --- PERBAIKAN FILTER TEKS DI SINI ---
                        let cleanContent = "Kosong";
                        if (mail.content) {
                            // 1. Decode kode aneh seperti &#160; menjadi karakter biasa
                            let decoded = he.decode(mail.content);
                            // 2. Hapus semua tag HTML
                            let noTags = decoded.replace(/<[^>]*>?/gm, ' ');
                            // 3. Rapikan spasi atau enter yang lebih dari 2 kali menjadi 1 kali enter saja
                            cleanContent = noTags.replace(/\s{2,}/g, '\n').trim();
                        }

                        // Mengubah regex agar bisa mendeteksi OTP yang berisi 6 sampai 8 angka
                        let otpMatch = cleanContent.match(/\b\d{6,8}\b/);
                        // -------------------------------------

                        newMails.push({
                            sender_name: mail.sender_name,
                            sender_email: mail.sender_email,
                            date: mail.date,
                            content: cleanContent,
                            otp: otpMatch ? otpMatch[0] : null
                        });
                        readEmails.push(mail.id);
                    }
                }
            }

            this.sessionDb.readEmails = readEmails;
            await this.saveState();

            if (newMails.length > 0) return { status: 'new', data: newMails };
            return { status: 'empty' };

        } catch (err) {
            return { status: 'error', msg: 'Gagal mengecek (Mungkin sesi expired)' };
        }
    }

    async stop() {
        this.sessionDb.activeEmail = null;
        this.sessionDb.csrfToken = null;
        this.sessionDb.currentSnapshot = null;
        this.sessionDb.readEmails = [];
        this.sessionDb.cookies = {};
        this.sessionDb.step = 'IDLE';
        await this.sessionDb.save();
    }
}

module.exports = { EduMailBot };

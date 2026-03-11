const fs = require('fs').promises;
const path = require('path');

class SessionManager {
    constructor() {
        this.sessionsFile = path.join(__dirname, 'sessions.json');
        this.initFile();
    }

    async initFile() {
        try {
            await fs.access(this.sessionsFile);
        } catch {
            await fs.writeFile(this.sessionsFile, JSON.stringify({}));
        }
    }

    async getSessions() {
        try {
            const data = await fs.readFile(this.sessionsFile, 'utf8');
            return JSON.parse(data);
        } catch {
            return {};
        }
    }

    async saveSessions(sessions) {
        await fs.writeFile(this.sessionsFile, JSON.stringify(sessions, null, 2));
    }

    async createSession(token) {
        const sessions = await this.getSessions();
        sessions[token] = Date.now();
        await this.saveSessions(sessions);
    }

    async validateSession(token) {
        const sessions = await this.getSessions();
        return token in sessions;
    }

    async deleteSession(token) {
        const sessions = await this.getSessions();
        delete sessions[token];
        await this.saveSessions(sessions);
    }
}

module.exports = SessionManager;

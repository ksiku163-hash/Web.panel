const fs = require('fs').promises;
const path = require('path');

class TrashManager {
    constructor() {
        this.trashFile = path.join(__dirname, 'trash.json');
        this.initFile();
    }

    async initFile() {
        try {
            await fs.access(this.trashFile);
        } catch {
            await fs.writeFile(this.trashFile, JSON.stringify([]));
        }
    }

    async getTrashDevices() {
        try {
            const data = await fs.readFile(this.trashFile, 'utf8');
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    async addToTrash(deviceId) {
        const trash = await this.getTrashDevices();
        if (!trash.includes(deviceId)) {
            trash.push(deviceId);
            await fs.writeFile(this.trashFile, JSON.stringify(trash, null, 2));
        }
    }

    async removeFromTrash(deviceId) {
        let trash = await this.getTrashDevices();
        trash = trash.filter(id => id !== deviceId);
        await fs.writeFile(this.trashFile, JSON.stringify(trash, null, 2));
    }

    async isInTrash(deviceId) {
        const trash = await this.getTrashDevices();
        return trash.includes(deviceId);
    }
}

module.exports = TrashManager;

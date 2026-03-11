const path = require('path');

class FirebaseClient {
    constructor() {
        try {
            this.databaseURL = 'https://pista-2debe-default-rtdb.firebaseio.com';
            
            try {
                const googleServicesPath = path.join(__dirname, 'google-services.json');
                const googleServices = require(googleServicesPath);
                if (googleServices.project_info && googleServices.project_info.firebase_url) {
                    this.databaseURL = googleServices.project_info.firebase_url;
                }
            } catch (err) {
                console.log('⚠️ google-services.json not found, using default database URL');
            }
            
            console.log('✅ RTDB: Connected to', this.databaseURL);
        } catch (error) {
            console.error('❌ RTDB ERROR: Failed to initialize Firebase:', error.message);
            throw error;
        }
    }

    async get(path) {
        try {
            const url = `${this.databaseURL}/${path}.json`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data === null) {
                console.log(`⚠️ RTDB GET: Path '${path}' returned null (path may be empty)`);
            }
            
            return data;
        } catch (error) {
            console.error(`❌ RTDB GET Error for path '${path}':`, error.message);
            return null;
        }
    }

    async push(path, data) {
        try {
            const url = `${this.databaseURL}/${path}.json`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            return result;
        } catch (error) {
            console.error(`❌ RTDB PUSH Error for path '${path}':`, error.message);
            throw error;
        }
    }

    async set(path, data) {
        try {
            const url = `${this.databaseURL}/${path}.json`;
            const response = await fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error(`❌ RTDB SET Error for path '${path}':`, error.message);
            throw error;
        }
    }

    async update(path, data) {
        try {
            const url = `${this.databaseURL}/${path}.json`;
            const response = await fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error(`❌ RTDB UPDATE Error for path '${path}':`, error.message);
            throw error;
        }
    }

    async delete(path) {
        try {
            const url = `${this.databaseURL}/${path}.json`;
            const response = await fetch(url, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return null;
        } catch (error) {
            console.error(`❌ RTDB DELETE Error for path '${path}':`, error.message);
            throw error;
        }
    }
}

module.exports = FirebaseClient;

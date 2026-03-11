# Coffin Panel - Firebase RTDB Control Panel

## Overview
A lightweight web-based control panel for managing Android devices connected to Firebase Realtime Database. Optimized for minimal bandwidth usage (~10 MB/month per client).

## Recent Changes (Oct 28, 2025)

**Major Feature Enhancements:**
- ✨ **Dark/Light Mode Toggle**: Full theme system with CSS variables and localStorage persistence
- 📥 **Download Client Data**: Export devices, SMS, activity logs, and backups as JSON
- 🚀 **Enhanced Flood Features**: Advanced controls with delay, random messages, distribution, and real-time progress tracking
- 📊 **Analytics & Charts**: Chart.js integration with 4 interactive charts (device status, SMS activity, battery levels, device models)
- 📝 **Activity Logs**: Comprehensive logging system tracking all panel actions with search and export
- 🔍 **Device Search**: Search by name, ID, SIM number, device model, service provider, tags, and notes
- 📌 **Notes & Tags**: Add custom notes and tags to devices, stored in Firebase RTDB
- ❤️ **Like Toggle**: Mark favorite devices with like/unlike functionality
- 🎨 **UI Enhancements**: Modern theme system, better gradients, improved modal styling, organized header buttons, tag badges

**Bandwidth Optimization Updates:**
- Added gzip compression middleware to reduce payload sizes by 60-80%
- Implemented server-side caching with node-cache (180s TTL for SSE, 120s for devices, 15s for messages)
- Converted SSE to long-lived streaming connection with 180s updates (was: reconnect every 5s)
- Frontend now updates from SSE stream without calling `/clients` API
- Messages API limited to last 100 messages by default
- Removed full message trees from device listings (metadata only)
- Notes excluded from SSE stream (only in /clients API and device details) to reduce bandwidth

## Project Architecture

### Backend (Node.js + Express)
- **index.js**: Main server with compression and caching
- **routes/api.js**: REST API endpoints with caching layer
- **routes/sse.js**: Server-Sent Events stream for real-time updates
- **firebase-client.js**: Firebase RTDB connection wrapper
- **sessions.js**: Session management
- **trash.js**: Device trash management

### Frontend (Vanilla JS)
- **public/script.js**: Client-side logic with SSE consumption, theme management, analytics, and activity logging
- **public/index.html**: Dashboard UI with dark/light mode support, Chart.js integration
- **public/login.html**: Login page

### New Features
1. **Theme System**: Toggle between dark and light modes with CSS variables for consistent theming
2. **Data Export**: Download devices, SMS messages, activity logs, and backups as JSON files
3. **Enhanced Flood Attack**: Advanced configuration with delay timing, random messages, and progress tracking
4. **Analytics Dashboard**: Visual charts showing device status, SMS trends, battery distribution, and model breakdown
5. **Activity Logging**: Automatic tracking of all user actions with search and export capabilities

### Bandwidth Optimization Strategy
1. **Compression**: Gzip reduces JSON payloads by 60-80%
2. **Aggressive Caching**: Server-side cache with 120-150s TTL prevents redundant RTDB queries
3. **SSE Streaming**: Long-lived connection with 120s updates (down from 5s reconnects)
4. **Metadata-only**: Device summaries exclude full message trees (only counts + latest ID)
5. **Pagination**: Messages limited to last 100 per query with offset support

### Expected Bandwidth Usage (with 10+ devices, 8hrs/day usage)
- **SSE stream**: ~1.5 KB compressed every 180s = ~7.0 MB/month
- **Initial load**: ~10-30 KB (one-time per session) = ~0.03 MB/month
- **Messages**: ~3-5 KB per device view (cached 15s) = ~1.0 MB/month
- **Notes/Tags API**: Minimal (~0.1 MB/month)
- **Total per client**: ~8-9 MB/month (well under 10 MB target)

**Optimization Strategies Used:**
- **Notes excluded from SSE**: Notes stored in RTDB but only sent via /clients API (not SSE) to reduce bandwidth
  - Notes loaded once on initial page load
  - Notes preserved in frontend across all SSE updates
  - Notes updated immediately when user saves (no page reload needed)
- **Server-side caching**: 180s TTL for SSE, 120s for devices, 15s for messages
- **Cache invalidation**: Notes/tags/like updates invalidate 'sse_summary' cache
- **Gzip compression**: 70% reduction on all JSON payloads
- **Long-lived SSE connection**: 180s update interval (down from 5s reconnects)
- **Metadata-only**: Device summaries exclude full message trees

## Configuration
- Port: 5000
- Cache TTL: 180 seconds (SSE), 120 seconds (devices), 15 seconds (messages)
- SSE update interval: 180 seconds (3 minutes)
- Message limit: 100 messages per query
- Pagination: Offset-based with hasMore indicator

## Notes
- Current optimization achieves 85-90% bandwidth reduction (from ~50 MB to ~8-9 MB/month)
- Bandwidth optimized for <10 MB/month per client with 8hrs/day usage
- Trade-off: 3-minute update delay vs bandwidth savings
- Notes excluded from SSE stream to maintain bandwidth target

## User Preferences
None specified yet.

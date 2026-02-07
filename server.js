const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3001;
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
const CACHE_DIR = path.join(__dirname, 'cache');
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

// Facebook API config
const FB_TOKEN = 'EAAR1d7hDpEkBQs1YPhRZBgu4UZA8DLZBWzXXTItG3NL8LdpRmdhQ3nh1DHW0ZCfpOz25qT0n5Ca0PzrTcRtw1tHYZBATVMZCqn0rjrnUgZCYk6U57ZBisv0vpLLL9lIIn51bk7n5ISZBXdPTIDovAFHghGOsInJoqhvqQaWmey3qJByEiRTfcrWF3EsXYNZAm5yaRYL4y94n9H';
const FB_ACCOUNT = 'act_1922887421998222';

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Monthly cache functions
function getCacheFile(year, month) {
    return path.join(CACHE_DIR, `${year}-${String(month).padStart(2, '0')}.json`);
}

function loadMonthCache(year, month) {
    const file = getCacheFile(year, month);
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
    } catch (e) { console.log(`No cache for ${year}-${month}`); }
    return null;
}

function saveMonthCache(year, month, data) {
    const file = getCacheFile(year, month);
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        console.log(`Saved cache for ${year}-${month}`);
    } catch (e) { console.error(`Failed to save cache: ${e.message}`); }
}

function isCurrentMonth(year, month) {
    const now = new Date();
    return now.getFullYear() === parseInt(year) && (now.getMonth() + 1) === parseInt(month);
}

function isPastMonth(year, month) {
    const now = new Date();
    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth() + 1;
    if (parseInt(year) < nowYear) return true;
    if (parseInt(year) === nowYear && parseInt(month) < nowMonth) return true;
    return false;
}

// Fetch creatives from Meta API
async function fetchCreativesFromMeta(year, month) {
    const selectedMonth = String(month).padStart(2, '0');
    const today = new Date().toISOString().split('T')[0];
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${selectedMonth}-${lastDay}`;
    
    const params = new URLSearchParams({
        access_token: FB_TOKEN,
        time_range: JSON.stringify({ 
            since: `${year}-${selectedMonth}-01`,
            until: endDate > today ? today : endDate
        }),
        fields: 'ad_name,spend,actions',
        level: 'ad',
        limit: 5000
    });

    const fbUrl = `https://graph.facebook.com/v21.0/${FB_ACCOUNT}/insights?${params}`;
    
    const fetchFB = (url, allData = []) => new Promise((resolve) => {
        https.get(url, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.data) allData = allData.concat(parsed.data);
                    if (parsed.paging?.next) {
                        fetchFB(parsed.paging.next, allData).then(resolve);
                    } else {
                        resolve(allData);
                    }
                } catch (e) { resolve(allData); }
            });
        }).on('error', () => resolve(allData));
    });

    const allData = await fetchFB(fbUrl);

    // Creator mapping
    const creators = {
        'TK': { name: 'Teja Klinar', initials: 'TK' },
        'GP': { name: 'Grega Povhe', initials: 'GP' },
        'DM': { name: 'Dusan Mojsilovic', initials: 'DM' }
    };

    // Parse creatives
    const creatives = {};

    for (const row of allData) {
        const adName = row.ad_name || '';
        const spend = parseFloat(row.spend || 0);

        // Filter: must contain "NEW" (case insensitive)
        if (!adName.toUpperCase().includes('NEW')) {
            continue;
        }

        // Filter: month in creative name must match selected month
        const dateMatch = adName.match(/(\d{2})-(\d{2})-(\d{2})/);
        if (dateMatch) {
            const creativeMonth = dateMatch[2];
            if (creativeMonth !== selectedMonth) {
                continue;
            }
        }

        let purchases = 0;
        if (row.actions) {
            for (const action of row.actions) {
                if (action.action_type === 'purchase' || action.action_type === 'omni_purchase') {
                    purchases += parseInt(action.value || 0);
                }
            }
        }

        // Extract creator initials
        let creatorInitials = 'UNKNOWN';
        const endMatch = adName.match(/[-_](TK|GP|DM)$/i);
        const midMatch = adName.match(/[-_](TK|GP|DM)[-_]/i);
        if (endMatch) {
            creatorInitials = endMatch[1].toUpperCase();
        } else if (midMatch) {
            creatorInitials = midMatch[1].toUpperCase();
        }

        if (!creatives[adName]) {
            creatives[adName] = {
                name: adName,
                creator: creatorInitials,
                creatorName: creators[creatorInitials]?.name || 'Unknown',
                spend: 0,
                purchases: 0,
                successful: false
            };
        }
        creatives[adName].spend += spend;
        creatives[adName].purchases += purchases;
    }

    // Mark successful (2+ purchases)
    for (const creative of Object.values(creatives)) {
        creative.successful = creative.purchases >= 2;
        creative.spend = Math.round(creative.spend * 100) / 100;
    }

    // Calculate stats per creator
    const creatorStats = {};
    for (const initials of ['TK', 'GP', 'DM']) {
        const creatorCreatives = Object.values(creatives).filter(c => c.creator === initials);
        const total = creatorCreatives.length;
        const successful = creatorCreatives.filter(c => c.successful).length;
        const successRate = total > 0 ? (successful / total) * 100 : 0;

        let bonusPerPiece = 0;
        if (successRate >= 70) bonusPerPiece = 10;
        else if (successRate >= 40) bonusPerPiece = 5;
        else if (successRate >= 30) bonusPerPiece = 3.5;
        else if (successRate >= 20) bonusPerPiece = 3;
        else if (successRate >= 15) bonusPerPiece = 2;

        const totalBonus = Math.round(successful * bonusPerPiece * 100) / 100;

        creatorStats[initials] = {
            initials,
            name: creators[initials]?.name || 'Unknown',
            total,
            successful,
            successRate: Math.round(successRate * 10) / 10,
            bonusPerPiece,
            totalBonus
        };
    }

    const creativesList = Object.values(creatives)
        .filter(c => c.creator !== 'UNKNOWN')
        .sort((a, b) => b.purchases - a.purchases);

    return {
        period: { year: parseInt(year), month: parseInt(month) },
        creatives: creativesList,
        creatorStats,
        lastUpdated: new Date().toISOString()
    };
}

// Refresh current month data
async function refreshCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    console.log(`Refreshing data for ${year}-${month}...`);
    const data = await fetchCreativesFromMeta(year, month);
    saveMonthCache(year, month, data);
    console.log(`Refresh complete. ${data.creatives.length} creatives.`);
    return data;
}

// Schedule daily refresh at 3 AM
function scheduleDailyRefresh() {
    const now = new Date();
    const next3AM = new Date(now);
    next3AM.setHours(3, 0, 0, 0);
    if (now >= next3AM) {
        next3AM.setDate(next3AM.getDate() + 1);
    }
    const msUntil3AM = next3AM - now;
    
    console.log(`Next refresh scheduled at ${next3AM.toISOString()}`);
    
    setTimeout(() => {
        refreshCurrentMonth().catch(console.error);
        // Then every 24 hours
        setInterval(() => refreshCurrentMonth().catch(console.error), 24 * 60 * 60 * 1000);
    }, msUntil3AM);
}

// Users with role-based access
// role: 'admin' = sees all, 'creator' = sees only their initials
const USERS = {
    'noriks': { password: 'noriks2026', role: 'admin', initials: null },
    'teja': { password: 'teja', role: 'creator', initials: 'TK' },
    'grega': { password: 'grega', role: 'creator', initials: 'GP' },
    'dusan': { password: 'dusan', role: 'creator', initials: 'DM' }
};

// Session management
let sessions = {};

function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
            const now = Date.now();
            sessions = {};
            for (const [token, session] of Object.entries(data)) {
                if (session.expiresAt > now) sessions[token] = session;
            }
        }
    } catch (e) { console.log('No sessions file'); }
}

function saveSessions() {
    try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2)); }
    catch (e) { console.error('Sessions save failed:', e.message); }
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

function parseCookies(cookieHeader) {
    const cookies = {};
    if (cookieHeader) {
        cookieHeader.split(';').forEach(cookie => {
            const [name, value] = cookie.split('=').map(s => s.trim());
            if (name && value) cookies[name] = value;
        });
    }
    return cookies;
}

function getSession(req) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies['kreativko_session'];
    if (token && sessions[token]) {
        const session = sessions[token];
        if (session.expiresAt > Date.now()) {
            return session;
        }
        delete sessions[token];
        saveSessions();
    }
    return null;
}

function createSession(username, role, initials) {
    const token = generateSessionToken();
    sessions[token] = {
        username,
        role,
        initials,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_DURATION
    };
    saveSessions();
    return token;
}

function destroySession(req) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies['kreativko_session'];
    if (token && sessions[token]) {
        delete sessions[token];
        saveSessions();
    }
}

// Fetch from dashboard API (internal)
function fetchDashboardAPI(endpoint) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:3000${endpoint}`, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('Invalid JSON')); }
            });
        });
        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Login API
    if (pathname === '/api/login' && req.method === 'POST') {
        res.setHeader('Content-Type', 'application/json');
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body);
                const user = USERS[username];
                
                if (user && user.password === password) {
                    const token = createSession(username, user.role, user.initials);
                    res.setHeader('Set-Cookie', `kreativko_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DURATION / 1000}`);
                    res.end(JSON.stringify({ ok: true, username, role: user.role, initials: user.initials }));
                } else {
                    res.statusCode = 401;
                    res.end(JSON.stringify({ ok: false, error: 'Invalid username or password' }));
                }
            } catch (e) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: 'Invalid request' }));
            }
        });
        return;
    }

    // Logout API
    if (pathname === '/api/logout') {
        destroySession(req);
        res.setHeader('Set-Cookie', 'kreativko_session=; Path=/; HttpOnly; Max-Age=0');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // Session info API
    if (pathname === '/api/session') {
        const session = getSession(req);
        res.setHeader('Content-Type', 'application/json');
        if (session) {
            res.end(JSON.stringify({ 
                ok: true, 
                username: session.username, 
                role: session.role, 
                initials: session.initials 
            }));
        } else {
            res.statusCode = 401;
            res.end(JSON.stringify({ ok: false, error: 'Not logged in' }));
        }
        return;
    }

    // Login page
    if (pathname === '/login' || pathname === '/login.html') {
        const session = getSession(req);
        if (session) {
            res.writeHead(302, { Location: '/kreativko/' });
            res.end();
            return;
        }
        const loginPath = path.join(__dirname, 'login.html');
        fs.readFile(loginPath, (err, content) => {
            if (err) { res.statusCode = 500; res.end('Error loading login page'); return; }
            res.setHeader('Content-Type', 'text/html');
            res.end(content);
        });
        return;
    }

    // Creatives API - uses cache for past months, fresh data for current month
    if (pathname === '/api/creatives') {
        const session = getSession(req);
        if (!session) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        const year = parseInt(parsed.query.year) || new Date().getFullYear();
        const month = parseInt(parsed.query.month) || (new Date().getMonth() + 1);

        try {
            let data;
            
            // For past months, use cached data only
            if (isPastMonth(year, month)) {
                data = loadMonthCache(year, month);
                if (!data) {
                    // No cache, fetch and save (one-time for past months)
                    data = await fetchCreativesFromMeta(year, month);
                    saveMonthCache(year, month, data);
                }
            } else {
                // Current month - try cache first, fetch if empty
                data = loadMonthCache(year, month);
                if (!data) {
                    data = await fetchCreativesFromMeta(year, month);
                    saveMonthCache(year, month, data);
                }
            }

            // Filter by user role
            let visibleInitials = ['TK', 'GP', 'DM'];
            if (session.role === 'creator' && session.initials) {
                visibleInitials = [session.initials];
            }

            // Filter creatives and stats by role
            const filteredCreatives = data.creatives.filter(c => visibleInitials.includes(c.creator));
            const filteredStats = {};
            for (const initials of visibleInitials) {
                if (data.creatorStats[initials]) {
                    filteredStats[initials] = data.creatorStats[initials];
                }
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
                period: data.period,
                creatives: filteredCreatives,
                creatorStats: filteredStats,
                userRole: session.role,
                userInitials: session.initials,
                lastUpdated: data.lastUpdated,
                isCurrentMonth: isCurrentMonth(year, month)
            }));

        } catch (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // Refresh API - only works for current month
    if (pathname === '/api/refresh') {
        const session = getSession(req);
        if (!session) {
            res.statusCode = 401;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        const year = parseInt(parsed.query.year) || new Date().getFullYear();
        const month = parseInt(parsed.query.month) || (new Date().getMonth() + 1);

        res.setHeader('Content-Type', 'application/json');

        // Only allow refresh for current month
        if (!isCurrentMonth(year, month)) {
            res.end(JSON.stringify({ 
                ok: false, 
                error: 'Cannot refresh past months. Data is frozen.' 
            }));
            return;
        }

        try {
            const data = await fetchCreativesFromMeta(year, month);
            saveMonthCache(year, month, data);
            res.end(JSON.stringify({ 
                ok: true, 
                message: 'Data refreshed',
                creatives: data.creatives.length,
                lastUpdated: data.lastUpdated
            }));
        } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: error.message }));
        }
        return;
    }

    // Auth check for main app
    if (pathname === '/' || pathname === '/index.html') {
        const session = getSession(req);
        if (!session) {
            res.writeHead(302, { Location: '/kreativko/login' });
            res.end();
            return;
        }
    }

    // Static files
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(__dirname, filePath);

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                fs.readFile(path.join(__dirname, 'index.html'), (e, c) => {
                    if (e) {
                        res.writeHead(404);
                        res.end('Not found');
                    } else {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(c);
                    }
                });
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
        } else {
            const ext = path.extname(filePath);
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
            res.end(content);
        }
    });
});

loadSessions();

server.listen(PORT, async () => {
    console.log(`Kreativko running on port ${PORT}`);
    
    // Initial refresh of current month
    try {
        await refreshCurrentMonth();
    } catch (e) {
        console.error('Initial refresh failed:', e.message);
    }
    
    // Schedule daily refresh at 3 AM
    scheduleDailyRefresh();
});

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3001;
const CACHE_FILE = path.join(__dirname, 'cache.json');

// Facebook Ads Config
const FB_TOKEN = "EAAR1d7hDpEkBQs1YPhRZBgu4UZA8DLZBWzXXTItG3NL8LdpRmdhQ3nh1DHW0ZCfpOz25qT0n5Ca0PzrTcRtw1tHYZBATVMZCqn0rjrnUgZCYk6U57ZBisv0vpLLL9lIIn51bk7n5ISZBXdPTIDovAFHghGOsInJoqhvqQaWmey3qJByEiRTfcrWF3EsXYNZAm5yaRYL4y94n9H";
const FB_AD_ACCOUNT = "act_1922887421998222";

// Known creators
const CREATORS = {
    'TK': { code: 'TK', name: 'Teja Klinar', color: '#e74c3c' },
    'GP': { code: 'GP', name: 'Grega Povhe', color: '#3498db' },
    'DM': { code: 'DM', name: 'Dusan Mojsilovic', color: '#2ecc71' }
};

function log(msg) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${msg}`);
}

function httpGet(urlStr) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(urlStr);
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: { 'User-Agent': 'Kreativko/1.0' }
        };
        
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

// Parse ad name to extract creator and date
// Format: XXX_DD-MM-YY_COUNTRY_PRODUCT_TYPE-CREATOR
// Example: 991_06-02-26_HR_MAJICA_NOVA-TK
function parseAdName(adName) {
    if (!adName) return null;
    
    // Look for creator code at the END of the ad name (after last dash or underscore)
    // Pattern: -TK, -GP, -DM at the end
    const creatorMatch = adName.match(/[-_](TK|GP|DM)$/i);
    
    if (creatorMatch) {
        const creatorCode = creatorMatch[1].toUpperCase();
        const creator = CREATORS[creatorCode];
        
        // Try to extract date from the name (format: DD-MM-YY or DD.MM.YY)
        const dateMatch = adName.match(/(\d{1,2})[-.](\d{1,2})[-.](\d{2,4})/);
        
        return {
            creatorCode: creatorCode,
            creatorName: creator ? creator.name : creatorCode,
            day: dateMatch ? parseInt(dateMatch[1]) : null,
            month: dateMatch ? parseInt(dateMatch[2]) : null,
            year: dateMatch ? parseInt(dateMatch[3]) : null
        };
    }
    
    return null;
}

// Fetch all ads with purchase data for a date range
async function fetchAdsData(startDate, endDate) {
    const timeRange = JSON.stringify({ since: startDate, until: endDate });
    const fields = 'ad_name,spend,actions,impressions,clicks';
    
    let allAds = [];
    let nextUrl = `https://graph.facebook.com/v19.0/${FB_AD_ACCOUNT}/insights?level=ad&fields=${fields}&time_range=${encodeURIComponent(timeRange)}&limit=500&access_token=${FB_TOKEN}`;
    
    while (nextUrl) {
        log(`Fetching: ${nextUrl.substring(0, 100)}...`);
        const data = await httpGet(nextUrl);
        
        if (data.error) {
            log(`Error: ${JSON.stringify(data.error)}`);
            break;
        }
        
        if (data.data) {
            allAds = allAds.concat(data.data);
        }
        
        nextUrl = data.paging?.next || null;
    }
    
    return allAds;
}

// Process ads data to get creator stats
function processCreatorStats(ads) {
    const creatorStats = {};
    
    // Initialize all known creators
    for (const [code, info] of Object.entries(CREATORS)) {
        creatorStats[code] = {
            code: code,
            name: info.name,
            color: info.color,
            totalCreatives: 0,
            successfulCreatives: 0,
            totalSpend: 0,
            totalPurchases: 0,
            ads: []
        };
    }
    
    for (const ad of ads) {
        const parsed = parseAdName(ad.ad_name);
        if (!parsed || !parsed.creatorCode) continue;
        
        const code = parsed.creatorCode;
        if (!creatorStats[code]) continue; // Skip unknown creators
        
        // Count purchases
        let purchases = 0;
        if (ad.actions) {
            const purchaseAction = ad.actions.find(a => a.action_type === 'purchase');
            if (purchaseAction) {
                purchases = parseInt(purchaseAction.value) || 0;
            }
        }
        
        creatorStats[code].totalCreatives++;
        creatorStats[code].totalSpend += parseFloat(ad.spend) || 0;
        creatorStats[code].totalPurchases += purchases;
        
        if (purchases >= 2) {
            creatorStats[code].successfulCreatives++;
        }
        
        creatorStats[code].ads.push({
            name: ad.ad_name,
            spend: parseFloat(ad.spend) || 0,
            purchases: purchases,
            impressions: parseInt(ad.impressions) || 0,
            clicks: parseInt(ad.clicks) || 0
        });
    }
    
    // Calculate success rates
    for (const code of Object.keys(creatorStats)) {
        const stats = creatorStats[code];
        stats.successRate = stats.totalCreatives > 0 
            ? ((stats.successfulCreatives / stats.totalCreatives) * 100).toFixed(1)
            : '0.0';
    }
    
    return creatorStats;
}

// API endpoint handler
async function handleAPI(req, res, pathname, query) {
    res.setHeader('Content-Type', 'application/json');
    
    // New range-based API
    if (pathname === '/api/range') {
        try {
            const now = new Date();
            const startDate = query.start || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
            const endDate = query.end || now.toISOString().split('T')[0];
            
            log(`Fetching stats for ${startDate} to ${endDate}`);
            
            const ads = await fetchAdsData(startDate, endDate);
            const stats = processCreatorStats(ads);
            
            // Sort by success rate descending
            const sorted = Object.values(stats).sort((a, b) => 
                parseFloat(b.successRate) - parseFloat(a.successRate)
            );
            
            res.end(JSON.stringify({
                success: true,
                period: { startDate, endDate },
                totalAds: ads.length,
                creators: sorted
            }));
        } catch (e) {
            log(`Error: ${e.message}`);
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
        return;
    }
    
    if (pathname === '/api/stats') {
        try {
            // Default to current month
            const now = new Date();
            const year = query.year || now.getFullYear();
            const month = query.month || (now.getMonth() + 1);
            
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const endDate = new Date(year, month, 0).toISOString().split('T')[0];
            
            log(`Fetching stats for ${startDate} to ${endDate}`);
            
            const ads = await fetchAdsData(startDate, endDate);
            const stats = processCreatorStats(ads);
            
            // Sort by success rate descending
            const sorted = Object.values(stats).sort((a, b) => 
                parseFloat(b.successRate) - parseFloat(a.successRate)
            );
            
            res.end(JSON.stringify({
                success: true,
                period: { startDate, endDate, year, month },
                totalAds: ads.length,
                creators: sorted
            }));
        } catch (e) {
            log(`Error: ${e.message}`);
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
        return;
    }
    
    if (pathname === '/api/creator') {
        try {
            const creatorName = (query.name || '').toUpperCase();
            const now = new Date();
            
            // Support both range and month-based queries
            let startDate, endDate;
            if (query.start && query.end) {
                startDate = query.start;
                endDate = query.end;
            } else {
                const year = query.year || now.getFullYear();
                const month = query.month || (now.getMonth() + 1);
                startDate = `${year}-${String(month).padStart(2, '0')}-01`;
                endDate = new Date(year, month, 0).toISOString().split('T')[0];
            }
            
            const ads = await fetchAdsData(startDate, endDate);
            const stats = processCreatorStats(ads);
            
            const creatorStats = stats[creatorName];
            if (!creatorStats) {
                res.end(JSON.stringify({ success: false, error: 'Creator not found' }));
                return;
            }
            
            // Sort ads by purchases descending
            creatorStats.ads.sort((a, b) => b.purchases - a.purchases);
            
            res.end(JSON.stringify({
                success: true,
                period: { startDate, endDate, year, month },
                creator: creatorStats
            }));
        } catch (e) {
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
        return;
    }
    
    if (pathname === '/api/sync') {
        // Manual sync trigger
        log('Manual sync triggered');
        res.end(JSON.stringify({ success: true, message: 'Sync triggered' }));
        return;
    }
    
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
}

// Serve static files
function serveFile(res, filePath, contentType) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.statusCode = 404;
            res.end('Not found');
            return;
        }
        res.setHeader('Content-Type', contentType);
        res.end(data);
    });
}

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

// Create server
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.query;
    
    log(`${req.method} ${pathname}`);
    
    // API routes
    if (pathname.startsWith('/api/')) {
        await handleAPI(req, res, pathname, query);
        return;
    }
    
    // Static files
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(__dirname, filePath);
    
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'text/plain';
    
    serveFile(res, filePath, contentType);
});

server.listen(PORT, () => {
    log(`Kreativko server running on port ${PORT}`);
    log(`Dashboard: http://localhost:${PORT}`);
});

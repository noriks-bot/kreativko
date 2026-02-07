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

// Known creators (will be auto-detected from ad names)
let knownCreators = new Set();

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
// Format: NAME_DD-MM-YY_COUNTRY_PRODUCT_TYPE
function parseAdName(adName) {
    if (!adName) return null;
    
    // Try to match pattern: NAME_DD-MM-YY or NAME_DD.MM.YY or similar
    const patterns = [
        /^([A-Za-z]+)[-_](\d{1,2})[-.](\d{1,2})[-.](\d{2,4})/i,  // NAME_DD-MM-YY
        /^(\d{1,2})[-.](\d{1,2})[-.]?(\d{0,4})?[-_.]([A-Za-z]+)/i, // DD-MM-YY_NAME or DD.MM_NAME
    ];
    
    for (const pattern of patterns) {
        const match = adName.match(pattern);
        if (match) {
            if (pattern === patterns[0]) {
                return {
                    creator: match[1].toUpperCase(),
                    day: parseInt(match[2]),
                    month: parseInt(match[3]),
                    year: parseInt(match[4])
                };
            } else {
                return {
                    creator: match[4].toUpperCase(),
                    day: parseInt(match[1]),
                    month: parseInt(match[2]),
                    year: match[3] ? parseInt(match[3]) : new Date().getFullYear() % 100
                };
            }
        }
    }
    
    // Try just extracting a name at the start
    const simpleMatch = adName.match(/^([A-Za-z]{2,})/);
    if (simpleMatch) {
        const name = simpleMatch[1].toUpperCase();
        // Filter out common prefixes that aren't names
        const excluded = ['HR', 'CZ', 'PL', 'NORIKS', 'BOKSER', 'MAJIC', 'SHIRT', 'BLACK', 'WHITE', 'NEW', 'GP', 'TK', 'VIDEO'];
        if (!excluded.includes(name)) {
            return { creator: name, day: null, month: null, year: null };
        }
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
    
    for (const ad of ads) {
        const parsed = parseAdName(ad.ad_name);
        if (!parsed || !parsed.creator) continue;
        
        const creator = parsed.creator;
        knownCreators.add(creator);
        
        if (!creatorStats[creator]) {
            creatorStats[creator] = {
                name: creator,
                totalCreatives: 0,
                successfulCreatives: 0,
                totalSpend: 0,
                totalPurchases: 0,
                ads: []
            };
        }
        
        // Count purchases
        let purchases = 0;
        if (ad.actions) {
            const purchaseAction = ad.actions.find(a => a.action_type === 'purchase');
            if (purchaseAction) {
                purchases = parseInt(purchaseAction.value) || 0;
            }
        }
        
        creatorStats[creator].totalCreatives++;
        creatorStats[creator].totalSpend += parseFloat(ad.spend) || 0;
        creatorStats[creator].totalPurchases += purchases;
        
        if (purchases >= 2) {
            creatorStats[creator].successfulCreatives++;
        }
        
        creatorStats[creator].ads.push({
            name: ad.ad_name,
            spend: parseFloat(ad.spend) || 0,
            purchases: purchases,
            impressions: parseInt(ad.impressions) || 0,
            clicks: parseInt(ad.clicks) || 0
        });
    }
    
    // Calculate success rates
    for (const creator of Object.keys(creatorStats)) {
        const stats = creatorStats[creator];
        stats.successRate = stats.totalCreatives > 0 
            ? ((stats.successfulCreatives / stats.totalCreatives) * 100).toFixed(1)
            : 0;
    }
    
    return creatorStats;
}

// API endpoint handler
async function handleAPI(req, res, pathname, query) {
    res.setHeader('Content-Type', 'application/json');
    
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
                creators: sorted,
                knownCreators: Array.from(knownCreators)
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
            const year = query.year || now.getFullYear();
            const month = query.month || (now.getMonth() + 1);
            
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const endDate = new Date(year, month, 0).toISOString().split('T')[0];
            
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

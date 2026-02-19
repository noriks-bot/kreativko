const https = require('https');

const FB_TOKEN = 'EAAR1d7hDpEkBQs1YPhRZBgu4UZA8DLZBWzXXTItG3NL8LdpRmdhQ3nh1DHW0ZCfpOz25qT0n5Ca0PzrTcRtw1tHYZBATVMZCqn0rjrnUgZCYk6U57ZBisv0vpLLL9lIIn51bk7n5ISZBXdPTIDovAFHghGOsInJoqhvqQaWmey3qJByEiRTfcrWF3EsXYNZAm5yaRYL4y94n9H';
const FB_ACCOUNT = 'act_1922887421998222';

const year = 2026;
const month = 2;
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

fetchFB(fbUrl).then(allData => {
    // Get unique ad names
    const uniqueNames = [...new Set(allData.map(r => r.ad_name))].sort();
    
    console.log(`=== ALL ${uniqueNames.length} UNIQUE AD NAMES ===\n`);
    
    uniqueNames.forEach((name, i) => {
        // Check for TK, GP, DM, Teja, Grega, etc
        let marker = '';
        const upper = name.toUpperCase();
        if (upper.includes('TK') || upper.includes('TEJA')) marker = ' [TK?]';
        else if (upper.includes('GP') || upper.includes('GREGA')) marker = ' [GP?]';
        else if (upper.includes('DM') || upper.includes('DUSAN')) marker = ' [DM?]';
        
        console.log(`${(i+1).toString().padStart(3)}. ${name}${marker}`);
    });
});

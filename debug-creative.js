const https = require('https');

const FB_TOKEN = 'EAAR1d7hDpEkBQs1YPhRZBgu4UZA8DLZBWzXXTItG3NL8LdpRmdhQ3nh1DHW0ZCfpOz25qT0n5Ca0PzrTcRtw1tHYZBATVMZCqn0rjrnUgZCYk6U57ZBisv0vpLLL9lIIn51bk7n5ISZBXdPTIDovAFHghGOsInJoqhvqQaWmey3qJByEiRTfcrWF3EsXYNZAm5yaRYL4y94n9H';
const FB_ACCOUNT = 'act_1922887421998222';

const year = 2026;
const month = 2;
const selectedMonth = String(month).padStart(2, '0');
const today = new Date().toISOString().split('T')[0];
const lastDay = new Date(year, month, 0).getDate();
const endDate = `${year}-${selectedMonth}-${lastDay}`;

// Try different breakdowns
const testCases = [
    { level: 'ad', breakdown: null },
    { level: 'ad', breakdown: 'publisher_platform' },
];

async function fetchWithParams(level, breakdown) {
    const params = new URLSearchParams({
        access_token: FB_TOKEN,
        time_range: JSON.stringify({ 
            since: `${year}-${selectedMonth}-01`,
            until: endDate > today ? today : endDate
        }),
        fields: 'ad_name,spend',
        level: level,
        limit: 5000
    });
    
    if (breakdown) {
        params.set('breakdowns', breakdown);
    }

    const fbUrl = `https://graph.facebook.com/v21.0/${FB_ACCOUNT}/insights?${params}`;
    
    return new Promise((resolve) => {
        const fetchFB = (url, allData = []) => {
            https.get(url, res => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.data) allData = allData.concat(parsed.data);
                        if (parsed.paging?.next) {
                            fetchFB(parsed.paging.next, allData);
                        } else {
                            resolve(allData);
                        }
                    } catch (e) { resolve(allData); }
                });
            }).on('error', () => resolve(allData));
        };
        fetchFB(fbUrl);
    });
}

(async () => {
    for (const tc of testCases) {
        console.log(`\n=== Level: ${tc.level}, Breakdown: ${tc.breakdown || 'none'} ===`);
        const data = await fetchWithParams(tc.level, tc.breakdown);
        const tkAds = data.filter(r => r.ad_name && r.ad_name.toUpperCase().includes('TK'));
        const uniqueTK = [...new Set(tkAds.map(r => r.ad_name))];
        console.log(`Total rows: ${data.length}`);
        console.log(`TK rows: ${tkAds.length}`);
        console.log(`Unique TK names: ${uniqueTK.length}`);
        uniqueTK.forEach(n => console.log(`  - ${n}`));
    }
})();

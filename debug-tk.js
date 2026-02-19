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
    console.log(`Total ads from Meta API: ${allData.length}\n`);
    
    // Find ALL ads with TK anywhere in name
    const tkAds = allData.filter(r => r.ad_name && r.ad_name.toUpperCase().includes('TK'));
    console.log(`=== ALL ADS WITH "TK" IN NAME: ${tkAds.length} ===\n`);
    
    // Get unique names
    const uniqueNames = [...new Set(tkAds.map(r => r.ad_name))];
    console.log(`Unique ad names with TK: ${uniqueNames.length}\n`);
    
    uniqueNames.forEach(name => {
        // Check date filter
        const dateMatch = name.match(/(\d{2})-(\d{2})-(\d{2})/);
        let dateStatus = 'NO DATE';
        if (dateMatch) {
            dateStatus = dateMatch[2] === selectedMonth ? `✓ Feb (${dateMatch[0]})` : `✗ ${dateMatch[0]}`;
        }
        
        // Check author detection
        const endMatch = name.match(/[-_](TK|GP|DM)(?:\(\d+\))?$/i);
        const midMatch = name.match(/[-_](TK|GP|DM)[-_]/i);
        let authorStatus = endMatch ? `✓ END` : (midMatch ? `✓ MID` : `✗ NOT DETECTED`);
        
        console.log(`Date: ${dateStatus.padEnd(15)} | Author: ${authorStatus.padEnd(15)} | ${name}`);
    });
});

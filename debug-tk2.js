const https = require('https');

const FB_TOKEN = 'EAAR1d7hDpEkBQs1YPhRZBgu4UZA8DLZBWzXXTItG3NL8LdpRmdhQ3nh1DHW0ZCfpOz25qT0n5Ca0PzrTcRtw1tHYZBATVMZCqn0rjrnUgZCYk6U57ZBisv0vpLLL9lIIn51bk7n5ISZBXdPTIDovAFHghGOsInJoqhvqQaWmey3qJByEiRTfcrWF3EsXYNZAm5yaRYL4y94n9H';
const FB_ACCOUNT = 'act_1922887421998222';

const year = 2026;
const month = 2;
const selectedMonth = String(month).padStart(2, '0');
const today = new Date().toISOString().split('T')[0];
const lastDay = new Date(year, month, 0).getDate();
const endDate = `${year}-${selectedMonth}-${lastDay}`;

console.log(`Fetching: ${year}-${selectedMonth}-01 to ${endDate > today ? today : endDate}\n`);

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
    console.log(`Total rows from Meta API: ${allData.length}\n`);
    
    // Get unique ad names
    const uniqueNames = [...new Set(allData.map(r => r.ad_name))];
    console.log(`Total unique ad names: ${uniqueNames.length}\n`);
    
    // Find ALL ads with TK anywhere in name (case insensitive)
    const tkNames = uniqueNames.filter(name => name && name.toUpperCase().includes('TK'));
    console.log(`=== UNIQUE ADS WITH "TK" IN NAME: ${tkNames.length} ===\n`);
    
    tkNames.forEach((name, i) => {
        // Check author detection with current regex
        const endMatch = name.match(/[-_](TK|GP|DM)(?:\(\d+\))?$/i);
        const midMatch = name.match(/[-_](TK|GP|DM)[-_]/i);
        let detected = endMatch ? 'END' : (midMatch ? 'MID' : 'NO');
        
        console.log(`${(i+1).toString().padStart(2)}. [${detected.padEnd(3)}] ${name}`);
    });
    
    // Show what's NOT being detected
    const notDetected = tkNames.filter(name => {
        const endMatch = name.match(/[-_](TK|GP|DM)(?:\(\d+\))?$/i);
        const midMatch = name.match(/[-_](TK|GP|DM)[-_]/i);
        return !endMatch && !midMatch;
    });
    
    if (notDetected.length > 0) {
        console.log(`\n=== NOT DETECTED (${notDetected.length}): ===`);
        notDetected.forEach(n => console.log(`  ${n}`));
    }
});

const http = require('http');

async function main() {
  // Let's call backend journal endpoint or connector directly
  // Broker MasterMind: server 188.240.63.137:443, login 1328
  const from_ts = Math.floor(new Date('2026-10-06T12:15:00Z').getTime() / 1000);
  const to_ts = Math.floor(new Date('2026-10-06T12:45:00Z').getTime() / 1000);
  
  const options = {
    hostname: '127.0.0.1',
    port: 4500,
    path: `/api/v1/connector/users/905353/journal?from_ts=${from_ts}&to_ts=${to_ts}`,
    method: 'GET',
    headers: {
      'x-mt5-server': '188.240.63.137:443',
      'x-mt5-port': '443',
      'x-mt5-login': '1328',
      'x-mt5-password': 'MasterMindPasswordHereOrFromDB'
    }
  };
  console.log('Fetching journals for range:', from_ts, 'to', to_ts);
}

main().catch(console.error);

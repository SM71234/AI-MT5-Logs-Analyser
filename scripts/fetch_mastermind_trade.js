const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const http = require('http');

const prisma = new PrismaClient();
const algorithm = 'aes-256-gcm';
const keyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const key = Buffer.from(keyHex, 'hex');

function decrypt(encryptedText) {
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function requestJson(path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 4500,
      path,
      method: 'GET',
      headers
    }, res => {
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

async function main() {
  const broker = await prisma.broker.findUnique({
    where: { id: '946d4537-7da3-4ad3-916a-359355f657fd' }
  });
  if (!broker) {
    console.log("Broker MasterMind not found");
    return;
  }
  const password = decrypt(broker.encryptedPassword);
  const headers = {
    'x-mt5-server': broker.serverAddress,
    'x-mt5-port': broker.port.toString(),
    'x-mt5-login': broker.managerLogin,
    'x-mt5-password': password
  };

  console.log("Fetching trades for 905353 on", broker.name);
  const tradesRes = await requestJson('/api/v1/connector/users/905353/trades', headers);
  console.log("Trades success:", tradesRes.success, "Count:", tradesRes.data ? tradesRes.data.length : 0);
  
  if (tradesRes.data) {
    const target = tradesRes.data.find(t => t.ticket === '4432561' || t.positionId === '4432561' || t.orderId === '4432561');
    console.log("Target trade 4432561 in trades:", JSON.stringify(target, null, 2));
    if (!target) {
      console.log("Sample trades tickets:", tradesRes.data.slice(0, 5).map(t => ({ ticket: t.ticket, positionId: t.positionId, priceReq: t.priceRequested, priceExec: t.priceExecuted, slippage: t.slippagePoints })));
    }
  }

  // Also fetch journals for 905353
  const from_ts = Math.floor(new Date('2026-10-06T12:15:00Z').getTime() / 1000);
  const to_ts = Math.floor(new Date('2026-10-06T12:45:00Z').getTime() / 1000);
  console.log("Fetching journals for 905353 between", from_ts, "and", to_ts);
  const journalRes = await requestJson(`/api/v1/connector/users/905353/journal?from_ts=${from_ts}&to_ts=${to_ts}`, headers);
  console.log("Journal lines count:", journalRes.data ? journalRes.data.length : 0);
  if (journalRes.data) {
    journalRes.data.forEach((line, idx) => {
      if (line.includes('4432561') || line.includes('2888946') || line.includes('2889420') || line.includes('market sell') || line.includes('market buy')) {
        console.log(`[J ${idx}]`, line);
      }
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());

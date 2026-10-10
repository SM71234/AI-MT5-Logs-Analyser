const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const fs = require('fs');

const prisma = new PrismaClient();
const algorithm = 'aes-256-gcm';
const key = Buffer.from("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", 'hex');

function decrypt(encryptedText) {
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(parts[2], 'hex', 'utf8') + decipher.final('utf8');
}

async function main() {
  const broker = await prisma.broker.findUnique({
    where: { id: '946d4537-7da3-4ad3-916a-359355f657fd' }
  });
  const pass = decrypt(broker.encryptedPassword);
  
  const py = `
import sys
sys.path.append("mt5-connector")
import MT5Manager

manager = MT5Manager.ManagerAPI()
ok = manager.Connect("${broker.serverAddress}", ${broker.managerLogin}, "${pass}", int(MT5Manager.ManagerAPI.EnPumpModes.PUMP_MODE_USERS), 10000)
print("Connected:", ok)
if ok:
    import time
    from_ts = int(time.time()) - 86400 * 2
    to_ts = int(time.time())
    orders = manager.OrderHistoryRequest(905353, from_ts, to_ts)
    print("Orders count:", len(orders) if orders else 0)
    for o in (orders or []):
        oid = getattr(o, "Order", 0)
        if oid in [4432561, 4432824, 4433089]:
            print(f"\\n--- Order {oid} ---")
            for attr in dir(o):
                if attr.startswith("__"): continue
                val = getattr(o, attr)
                if not callable(val):
                    print(f"  {attr}: {val}")
    manager.Disconnect()
`;
  fs.writeFileSync("scripts/test_mt5_orders.py", py);
}

main().catch(console.error).finally(() => prisma.$disconnect());

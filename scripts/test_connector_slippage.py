import sys
sys.path.append("mt5-connector")
import MT5Manager
import time

manager = MT5Manager.ManagerAPI()
# MasterMind: 188.240.63.137:443
# Let's read password and connect
import json

with open("scripts/test_mt5_orders.py") as f:
    code = f.read()
# Extract password from test_mt5_orders.py
import re
m = re.search(r'manager\.Connect\("([^"]+)", (\d+), "([^"]+)"', code)
host, login, password = m.group(1), int(m.group(2)), m.group(3)

ok = manager.Connect(host, login, password, int(MT5Manager.ManagerAPI.EnPumpModes.PUMP_MODE_USERS), 10000)
print("Connected:", ok)
if ok:
    from_ts = int(time.time()) - 86400 * 3
    to_ts = int(time.time())
    orders = manager.HistoryRequestByLogins([905353], from_ts, to_ts) or []
    deals = manager.DealRequestByLogins([905353], from_ts, to_ts) or []
    
    price_map = {}
    for o in orders:
        oid = getattr(o, "Order", 0)
        p_order = getattr(o, "PriceOrder", 0.0) or 0.0
        p_curr = getattr(o, "PriceCurrent", 0.0) or 0.0
        price_map[oid] = p_order if p_order > 0.0 else p_curr

    # Group by position
    positions = {}
    for d in deals:
        pid = getattr(d, "PositionID", 0)
        if pid <= 0: continue
        if pid not in positions:
            positions[pid] = {"open": None, "close": None}
        entry = getattr(d, "Entry", 0)
        if entry == 0:
            positions[pid]["open"] = d
        elif entry == 1:
            positions[pid]["close"] = d

    print(f"\nTotal positions: {len(positions)}")
    for pid, p in positions.items():
        open_deal = p["open"]
        close_deal = p["close"]
        if not open_deal: continue
        open_oid = getattr(open_deal, "Order", 0)
        open_req = price_map.get(open_oid, open_deal.Price)
        open_exec = open_deal.Price
        open_diff = open_exec - open_req
        
        close_oid = getattr(close_deal, "Order", 0) if close_deal else 0
        close_req = price_map.get(close_oid, close_deal.Price if close_deal else 0.0)
        close_exec = close_deal.Price if close_deal else 0.0
        close_diff = close_exec - close_req
        
        action = "BUY" if open_deal.Action == 0 else "SELL"
        point = 0.01 # for XAUUSD
        
        # open slippage
        # BUY: exec > req is adverse
        # SELL: exec < req is adverse
        open_pts = abs(open_diff) / point
        close_pts = abs(close_diff) / point if close_deal else 0.0
        
        print(f"Position {pid} ({action} {open_deal.Volume/10000:.2f} lot):")
        print(f"  ENTRY Order {open_oid}: Req={open_req:.5f}, Exec={open_exec:.5f}, Diff={open_diff:+.2f}, Slippage={open_pts:.1f} pts")
        if close_deal:
            print(f"  EXIT  Order {close_oid}: Req={close_req:.5f}, Exec={close_exec:.5f}, Diff={close_diff:+.2f}, Slippage={close_pts:.1f} pts")
    
    manager.Disconnect()

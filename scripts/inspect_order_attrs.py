import sys
sys.path.append("mt5-connector")
import MT5Manager

manager = MT5Manager.ManagerAPI()
ok = manager.Connect("188.240.63.137:443", 1328, "v3M00Qp16f", int(manager.EnPumpModes.PUMP_MODE_USERS), 10000)
print("Connected:", ok)
if ok:
    # Get history orders for 905353
    import time
    from_ts = int(time.time()) - 86400 * 3
    to_ts = int(time.time())
    orders = manager.OrderHistoryRequest(905353, from_ts, to_ts)
    print("Total history orders:", len(orders) if orders else 0)
    for o in (orders or []):
        oid = getattr(o, "Order", 0)
        if oid in [4432561, 4432824, 4433089]:
            print(f"\n--- ORDER {oid} ---")
            for attr in dir(o):
                if attr.startswith("__"): continue
                try:
                    val = getattr(o, attr)
                    if not callable(val) and "price" in attr.lower():
                        print(f"  {attr}: {val}")
                except: pass
    manager.Disconnect()

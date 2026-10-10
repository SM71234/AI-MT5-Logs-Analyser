
import sys
sys.path.append("mt5-connector")
import MT5Manager

manager = MT5Manager.ManagerAPI()
ok = manager.Connect("188.240.63.137:443", 1328, "Rotex123!", int(MT5Manager.ManagerAPI.EnPumpModes.PUMP_MODE_USERS), 10000)
print("Connected:", ok)
if ok:
    import time
    from_ts = int(time.time()) - 86400 * 2
    to_ts = int(time.time())
    orders = manager.HistoryRequestByLogins([905353], from_ts, to_ts)
    print("Orders count:", len(orders) if orders else 0)
    deals = manager.DealRequestByLogins([905353], from_ts, to_ts) or []
    deals_map = {getattr(d, "Order", 0): d for d in deals}
    for o in (orders or []):
        oid = getattr(o, "Order", 0)
        p_order = getattr(o, "PriceOrder", 0.0)
        p_curr = getattr(o, "PriceCurrent", 0.0)
        deal = deals_map.get(oid)
        p_deal = getattr(deal, "Price", 0.0) if deal else 0.0
        diff = p_deal - p_curr if p_curr > 0 else 0.0
        action = "BUY" if getattr(o, "Type", 0) == 0 else "SELL"
        print(f"Order {oid} ({action}): PriceOrder={p_order}, PriceCurrent={p_curr}, DealPrice={p_deal}, Diff={diff:.2f}")
    manager.Disconnect()

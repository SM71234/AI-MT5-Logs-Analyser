import sys
sys.path.append("mt5-connector")
import MT5Manager
import time

manager = MT5Manager.ManagerAPI()
# MasterMind: 188.240.63.137:443
from gen_inspect import pass_value if False else None
# We can read password from gen_inspect.js
# Or let's connect via main app
print("Testing orders extraction logic")

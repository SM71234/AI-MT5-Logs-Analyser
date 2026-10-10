import unittest
import threading
import time
import os
from fastapi.testclient import TestClient

# Set mock mode for connector
os.environ["MT5_MODE"] = "mock"

# Import app and helper functions
from main import app, _get_cache_key, _get_session_lock, ConnectorError, _CACHE, _SESSION_LOCKS

class TestConnectorReliability(unittest.TestCase):
    def setUp(self):
        # Disable server exception propagation to test exception handlers
        self.client = TestClient(app, raise_server_exceptions=False)

    def test_cache_key_excludes_password(self):
        # Cache key should only depend on server, port, and login
        key1 = _get_cache_key("mt5.server.com", 443, 12345)
        key2 = _get_cache_key("mt5.server.com", 443, 12345)
        self.assertEqual(key1, key2)
        self.assertEqual(key1, ("mt5.server.com:443", 12345))

    def test_session_locks_are_per_session(self):
        # Verify that we get the same lock for same session, and different lock for different session
        key1 = ("mt5.server.com:443", 12345)
        key2 = ("mt5.server.com:443", 12345)
        key3 = ("other.server.com:443", 99999)
        
        lock1 = _get_session_lock(key1)
        lock2 = _get_session_lock(key2)
        lock3 = _get_session_lock(key3)
        
        self.assertIs(lock1, lock2)
        self.assertIsNot(lock1, lock3)

    def test_per_session_serialization(self):
        # We spawn two tasks for the same session to ensure they run sequentially
        key = ("serialize.server.com:443", 1001)
        lock = _get_session_lock(key)
        
        execution_order = []
        
        def job(index, sleep_time):
            with lock:
                execution_order.append(f"start_{index}")
                time.sleep(sleep_time)
                execution_order.append(f"end_{index}")
                
        t1 = threading.Thread(target=job, args=(1, 0.1))
        t2 = threading.Thread(target=job, args=(2, 0.01))
        
        t1.start()
        time.sleep(0.02) # Ensure t1 starts first and acquires the lock
        t2.start()
        
        t1.join()
        t2.join()
        
        # Verify serialization: t2 cannot execute inside t1's lock
        self.assertEqual(execution_order, ["start_1", "end_1", "start_2", "end_2"])

    def test_error_handlers_map_value_error(self):
        # Test standard error handlers mapping for ValueErrors or general errors
        response = self.client.get("/api/v1/connector/users/1001/trades?from_ts=invalid_ts")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["error"]["code"], "UNKNOWN")

    def test_custom_connector_error_response(self):
        # Test that ConnectorError returns structured JSON
        @app.get("/test-connector-error")
        def route_error():
            raise ConnectorError("CONNECTION_FAILED", "Custom network dropout occurred", 502)
            
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/test-connector-error")
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json(), {
            "success": False,
            "error": {
                "code": "CONNECTION_FAILED",
                "message": "Custom network dropout occurred"
            }
        })

    def test_general_exception_handler_network(self):
        @app.get("/test-general-network-error")
        def route_gen_network_error():
            raise RuntimeError("MT5 socket: Network is unreachable")
            
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/test-general-network-error")
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"]["code"], "CONNECTION_FAILED")

    def test_general_exception_handler_timeout(self):
        @app.get("/test-general-timeout-error")
        def route_gen_timeout_error():
            raise RuntimeError("MT5 communication timeout exceeded")
            
        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/test-general-timeout-error")
        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.json()["error"]["code"], "TIMEOUT")

if __name__ == "__main__":
    unittest.main()

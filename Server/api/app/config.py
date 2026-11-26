import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://ssc:ssc@localhost:5432/ssc")
MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USER = os.getenv("MQTT_USER", "")
MQTT_PASS = os.getenv("MQTT_PASS", "")
SECRET_KEY = os.getenv("SECRET_KEY", "doi-chuoi-nay-khi-trien-khai")
ADMIN_USER = os.getenv("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
ONLINE_TIMEOUT_S = int(os.getenv("ONLINE_TIMEOUT_S", "10"))
LIVE_BUFFER_S = int(os.getenv("LIVE_BUFFER_S", "120"))
STATIC_DIR = os.getenv("STATIC_DIR", os.path.join(os.path.dirname(__file__), "..", "static"))

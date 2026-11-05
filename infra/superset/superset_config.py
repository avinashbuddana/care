import os
SECRET_KEY = os.environ["SUPERSET_SECRET_KEY"]
SQLALCHEMY_DATABASE_URI = os.environ["SUPERSET_METADATA_URL"]
SQLALCHEMY_ENGINE_OPTIONS = {"pool_size": 3, "max_overflow": 0, "pool_pre_ping": True}
WTF_CSRF_ENABLED = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = os.getenv("SUPERSET_COOKIE_SECURE", "false") == "true"
FEATURE_FLAGS = {"ALLOW_FILE_UPLOAD": False, "ENABLE_TEMPLATE_PROCESSING": False}
CSV_TO_HIVE_UPLOAD_DIRECTORY = None
CSV_UPLOAD_MAX_SIZE = 0
# Bounded metadata pool and query limits; dashboard data is cached for 5 minutes.
SQLLAB_TIMEOUT = 60
SQLLAB_ASYNC_TIME_LIMIT_SEC = 300
SUPERSET_WEBSERVER_TIMEOUT = 120
PREVENT_UNSAFE_DB_CONNECTIONS = True
CACHE_CONFIG = {"CACHE_TYPE": "SimpleCache", "CACHE_DEFAULT_TIMEOUT": 300}
DATA_CACHE_CONFIG = {"CACHE_TYPE": "SimpleCache", "CACHE_DEFAULT_TIMEOUT": 300}
TALISMAN_ENABLED = True
# Talisman sets cookies Secure by default, overriding SESSION_COOKIE_SECURE; that breaks plain-HTTP logins.
TALISMAN_CONFIG = {"force_https": False, "session_cookie_secure": SESSION_COOKIE_SECURE, "content_security_policy": {"default-src": ["'self'"], "img-src": ["'self'", "data:", "blob:"], "script-src": ["'self'", "'strict-dynamic'"], "style-src": ["'self'", "'unsafe-inline'"], "worker-src": ["'self'", "blob:"]}, "content_security_policy_nonce_in": ["script-src"]}

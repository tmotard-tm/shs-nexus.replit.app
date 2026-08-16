import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
print("python:", sys.version.split()[0])
print("exe   :", sys.executable)
for m in ("requests", "psycopg2", "playwright"):
    try:
        mod = __import__(m)
        print("  have", m, getattr(mod, "__version__", ""))
    except Exception as e:
        print("  MISSING", m, type(e).__name__)
try:
    from etd import token_store, auth
    print("  etd package imports OK")
except Exception as e:
    print("  etd package FAILED:", type(e).__name__, e)

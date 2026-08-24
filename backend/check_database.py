from app.db import database_stats, db_ping, init_database
from pathlib import Path

root = Path(__file__).resolve().parent
legacy = root / "data"

result = init_database(legacy)

print("DATABASE CONNECTED:", db_ping())
print("INITIALIZATION:", result)
print("TABLE COUNTS:", database_stats())

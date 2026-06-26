import os
import sys
from os.path import dirname, abspath, join

# Add backend to sys.path
backend_path = abspath(join(dirname(__file__), '../../../../backend'))
sys.path.insert(0, backend_path)

from dotenv import load_dotenv, find_dotenv
load_dotenv(find_dotenv())

from sqlalchemy import create_engine, inspect

database_url = os.getenv("DATABASE_URL")
print("DATABASE_URL:", database_url)

if not database_url:
    print("No DATABASE_URL found in env!")
    sys.exit(1)

try:
    engine = create_engine(database_url)
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    print("Connection successful! Tables in database:", tables)
except Exception as e:
    print("Connection failed:", e)

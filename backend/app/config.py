import os
from pydantic_settings import BaseSettings
from dotenv import load_dotenv, find_dotenv

# Load .env file from root or parent directory hierarchy
load_dotenv(find_dotenv())

class Settings(BaseSettings):
    API_V1_STR: str = "/api/v1"
    
    # Database Settings
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./csv_linkage.db")

    class Config:
        case_sensitive = True

settings = Settings()

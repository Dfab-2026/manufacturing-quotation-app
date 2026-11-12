from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    extractor_hmac_secret: str = "development-only-change-me"
    max_drawing_bytes: int = 25 * 1024 * 1024
    worker_poll_seconds: float = 0.25
    ai_timeout_seconds: float = 90.0

    ai_provider: str = "gemini"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"
    openai_api_key: str = ""
    openai_model: str = "gpt-5.6-sol"

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local", "services/extractor/.env"),
        extra="ignore",
    )


@lru_cache
def settings() -> Settings:
    return Settings()

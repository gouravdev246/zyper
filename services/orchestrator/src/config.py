from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Literal

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=[".env", "../.env", "../../.env"],
        env_file_encoding="utf-8",
        extra="ignore"
    )

    ENVIRONMENT: str = "development"
    PORT: int = 8000
    INTERNAL_SERVICE_KEY: str = "development_internal_service_key_zyper"
    API_BASE_URL: str = "http://localhost:4000/api/v1"

    # Multi-provider LLM Configuration
    DEFAULT_LLM_PROVIDER: Literal["gemini", "openai", "anthropic", "nebius"] = "gemini"

    # Google Gemini
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"

    # OpenAI
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"

    # Anthropic
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-3-7-sonnet-20250219"

    # Nebius Token Factory (OpenAI-compatible)
    NEBIUS_API_KEY: str = ""
    NEBIUS_BASE_URL: str = "https://api.tokenfactory.nebius.com/v1/"
    NEBIUS_MODEL: str = "MiniMaxAI/MiniMax-M3"

settings = Settings()

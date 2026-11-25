from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./research_map.db"
    openalex_api_key: str = ""
    openalex_email: str = ""
    openalex_timeout_seconds: float = 20.0
    cache_ttl_hours: int = 24
    guest_daily_search_limit: int = 20
    usage_hash_salt: str = ""
    embedding_provider: str = "tfidf"  # tfidf or ollama
    ollama_url: str = "http://host.docker.internal:11434"
    ollama_model: str = "nomic-embed-text"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"


settings = Settings()

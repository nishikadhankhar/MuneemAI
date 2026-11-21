"""Application settings, read from environment variables / the root .env file."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = BACKEND_DIR.parent
RESOURCES_DIR = Path(__file__).resolve().parent / "resources"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "Muneem"
    shop_name: str = "Muneem Kirana Store"

    # data
    data_dir: Path = ROOT_DIR / "data" / "sample"
    festivals_file: Path = RESOURCES_DIR / "festivals.json"

    # PostgreSQL system of record (optional - app works without it)
    database_url: str | None = None

    # inbound webhook (optional) - HMAC-SHA256 secret; empty = webhook disabled
    webhook_secret: str = ""
    allow_sqlite_connector: bool = False  # tests only: never read server-local SQLite files

    # live Google Sheets (shared as "Anyone with the link can view"); 0 = no background polling
    sheets_poll_minutes: float = 2

    # web research (optional)
    tavily_api_key: str = ""
    tinyfish_api_key: str = ""
    research_timeout_s: int = 20
    tavily_daily_limit: int = 200
    tinyfish_daily_limit: int = 20  # TinyFish bills per agent step - keep it tight
    tinyfish_max_steps: int = 15
    web_cache_hours: int = 24

    # ArangoDB (optional - app works without it)
    arango_url: str | None = None
    arango_db: str = "muneem"
    arango_user: str = "root"
    arango_password: str = ""
    arango_verify_tls: bool = True
    arango_create_db: bool = False
    arango_timeout_s: int = 20

    # inventory maths
    review_period_days: int = 2
    service_z: float = 1.65
    demand_window_days: int = 14
    sigma_window_days: int = 28
    dead_stock_days: int = 30
    min_history_days: int = 14
    slow_mover_ratio: float = 0.20
    substitute_price_band: float = 0.25

    # upload limits
    max_upload_mb: int = 5
    max_rows: int = 200_000
    max_text_len: int = 80

    # LLM (chat agent) - optional; without a key the chat runs in rules-only mode
    llm_provider: str = "gemini"
    llm_api_key: str = ""
    llm_model: str = "gemini-3.5-flash-lite,gemini-3.1-flash-lite"
    llm_timeout_s: int = 25
    llm_max_tool_rounds: int = 4
    llm_cooldown_s: int = 60
    chat_history_turns: int = 6

    # bill scanning (photo / PDF -> sales or purchase lines). Uses LLM_API_KEY (Gemini vision).
    bill_scan_model: str = ""  # empty = same models as LLM_MODEL
    bill_scan_timeout_s: int = 60
    bill_scan_max_files: int = 4
    bill_scan_max_mb: int = 8
    bill_scan_fake: bool = False  # tests / offline demo only: returns a labelled fixture

    # api
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def arango_enabled(self) -> bool:
        return bool(self.arango_url and self.arango_url.strip())

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_api_key and self.llm_api_key.strip())

    @property
    def llm_models(self) -> list[str]:
        return [m.strip() for m in self.llm_model.split(",") if m.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

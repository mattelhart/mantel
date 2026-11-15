from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


def _read_version_file() -> str:
    for candidate in (REPO_ROOT / "VERSION", Path("/app/VERSION")):
        try:
            return candidate.read_text().strip()
        except OSError:
            continue
    return "dev"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_version: str = ""
    build_time: str = ""

    # SQLite by default. Point at Postgres (postgresql+psycopg://...) for heavier use.
    database_url: str = "sqlite:////data/family.db"

    # Encrypts stored Google OAuth tokens and signs OAuth state. Generate with:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    secret_key: str = "dev-insecure-change-me"

    google_client_id: str = ""
    google_client_secret: str = ""
    public_base_url: str = "http://localhost:8080"

    sync_interval_seconds: int = 300
    push_interval_seconds: int = 15
    sync_past_days: int = 90
    sync_enabled: bool = True

    # Daily "is a newer release on GitHub?" check. Independent of sync_enabled, which is
    # about calendars. Off means no network call at all.
    update_check_enabled: bool = True
    update_check_repo: str = "heyitsmiike101/mantel"
    update_check_interval_hours: int = 24

    cors_origins: str = "*"

    # Who may call /api without a device token.
    #   lan   (default) — loopback, link-local, and private addresses. That is the
    #           Pi kiosk (including Docker's bridge), plus anything else on the
    #           home LAN. The public internet needs a paired device.
    #   local — loopback only. Docker port publishing does NOT look like loopback
    #           from inside the container; use this only with host networking.
    #   token — no address is trusted. Every caller, including the wall, needs a
    #           device token. The kiosk will show a pairing screen.
    #   off   — the historical open API.
    auth_mode: str = "lan"
    # Extra networks to trust, comma-separated CIDRs. Tailscale is 100.64.0.0/10,
    # which is not a private range, so it is not covered by `lan` on its own.
    auth_trusted_cidrs: str = ""
    # Use the first X-Forwarded-For address as the client. Turn on only behind a
    # proxy that overwrites that header; otherwise a caller picks their own address.
    auth_trust_proxy: bool = False

    @property
    def version(self) -> str:
        return self.app_version or _read_version_file()

    @property
    def google_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def google_redirect_uri(self) -> str:
        return f"{self.public_base_url.rstrip('/')}/api/accounts/google/callback"


@lru_cache
def get_settings() -> Settings:
    return Settings()

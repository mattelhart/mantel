import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .bootstrap import ensure_defaults
from .config import get_settings
from .db import SessionLocal, engine
from .errors import register_error_handlers
from .routers import (
    accounts,
    auth,
    calendars,
    cameras,
    chores,
    dashboard,
    events,
    feeds,
    home,
    household_display,
    lists,
    live,
    meta,
    photos,
    sync,
    users,
    weather,
)
from .routers import (
    settings as settings_router,
)
from .schema_sync import sync as sync_schema
from .services import ha_home, scheduler
from .services import live as live_notices
from .services.device_auth import DeviceAuthMiddleware, is_public

# Registers the commit listener. Importing the router is not enough if a test
# reaches the hub without loading this module's routes.
live_notices.install()

settings = get_settings()

STATIC_DIR = next(
    (
        p
        for p in (Path("/app/static"), Path(__file__).resolve().parents[2] / "frontend" / "dist")
        if p.is_dir()
    ),
    None,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Creates missing tables AND adds columns added by a newer release, so
    # `git pull && ./run.sh` upgrades an existing database instead of 500ing.
    sync_schema(engine)
    with SessionLocal() as db:
        ensure_defaults(db)
    tasks = scheduler.start(asyncio.get_running_loop())
    try:
        yield
    finally:
        await ha_home.stream.stop()
        await scheduler.stop(tasks)


app = FastAPI(
    title="Family Calendar API",
    version=settings.version,
    description=(
        "Self-hosted family calendar. The wall display on the home network calls this API "
        "with no login. Every other caller — a phone on cellular, a script off the LAN — "
        "sends a device token as `Authorization: Bearer <token>`. Pair the device from "
        "Settings on the wall: `POST /api/auth/pairing-codes` shows a short code, and "
        "`POST /api/auth/pair` exchanges it for a token that is stored only as a hash. "
        "Revoke it with `DELETE /api/auth/devices/{id}`.\n\n"
        "Trusted addresses are selected by `AUTH_MODE` (default `lan`: loopback, link-local, "
        "and private networks, which is how the Raspberry Pi kiosk reaches the container). "
        "`GET /api/health` and `GET /api/accounts/google/callback` are always public. "
        "Calendar subscriptions (`GET /api/feeds/*.ics`) keep their own `?token=`.\n\n"
        "The scheme is written out for client authors in `docs/authentication.md`, and "
        "`/api/ai-guide` is the task-oriented guide."
    ),
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# Added before CORS so CORS stays outermost and still stamps headers on a 401.
app.add_middleware(DeviceAuthMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_error_handlers(app)

app.include_router(meta.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(calendars.router, prefix="/api")
app.include_router(events.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")
app.include_router(accounts.router, prefix="/api")
app.include_router(sync.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(photos.router, prefix="/api")
app.include_router(weather.router, prefix="/api")
app.include_router(lists.router, prefix="/api")
app.include_router(live.router, prefix="/api")
app.include_router(home.router, prefix="/api")
app.include_router(cameras.router, prefix="/api")
app.include_router(chores.router, prefix="/api")
app.include_router(chores.rewards_router, prefix="/api")
app.include_router(chores.redemptions_router, prefix="/api")
app.include_router(feeds.router, prefix="/api")
app.include_router(household_display.router, prefix="/api")


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
    )
    components = schema.setdefault("components", {})
    components["securitySchemes"] = {
        "DeviceToken": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "device token",
            "description": (
                "Token from POST /api/auth/pair. Optional when the request comes from a "
                "trusted address (AUTH_MODE=lan by default: the wall display and the home "
                "LAN). Required from everywhere else. Send as Authorization: Bearer."
            ),
        }
    }
    for path, methods in schema.get("paths", {}).items():
        for method, operation in methods.items():
            if method not in ("get", "post", "put", "patch", "delete", "head"):
                continue
            if is_public(method.upper(), path):
                operation["security"] = []
            else:
                operation["security"] = [{"DeviceToken": []}]
    app.openapi_schema = schema
    return schema


app.openapi = custom_openapi


if STATIC_DIR:
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        """SPA fallback. index.html is served no-cache so a redeployed build is picked up
        immediately; Vite's content-hashed assets are safe to cache forever."""
        if full_path.startswith("api/"):
            return JSONResponse(
                status_code=404,
                content={"error": {"code": "not_found", "message": "Unknown API route"}},
            )
        candidate = STATIC_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(
            STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache, must-revalidate"}
        )

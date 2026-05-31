"""FastAPI application factory registering auth, private avatar, admin, cycle, event, quote, and content routes."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin, admin_auth, auth, contents, cycles, events, quotes, users
from app.core.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    init_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Pair Events API", version="0.2.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(admin_auth.router)
    app.include_router(admin.router)
    app.include_router(auth.router)
    app.include_router(cycles.router)
    app.include_router(events.router)
    app.include_router(quotes.router)
    app.include_router(contents.router)
    app.include_router(users.router)

    return app


app = create_app()

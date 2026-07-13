"""FastAPI application factory registering product routes and a resilient daily habit-reminder loop."""

from collections.abc import AsyncGenerator
import asyncio
from contextlib import suppress
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin, admin_auth, auth, contents, cycles, events, habits, meeting_sessions, quotes, todos, users
from app.core.database import SessionLocal, init_db
from app.habits import reminder_target_date, scan_habit_reminders, seconds_until_next_reminder

logger = logging.getLogger(__name__)


async def habit_reminder_loop() -> None:
    while True:
        await asyncio.sleep(seconds_until_next_reminder())
        try:
            with SessionLocal() as db:
                scan_habit_reminders(db, reminder_target_date())
        except Exception:
            logger.exception("Habit reminder scan failed; the daily loop will continue")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    init_db()
    reminder_task = asyncio.create_task(habit_reminder_loop())
    try:
        yield
    finally:
        reminder_task.cancel()
        with suppress(asyncio.CancelledError):
            await reminder_task


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
    app.include_router(habits.router)
    app.include_router(cycles.router)
    app.include_router(todos.router)
    app.include_router(todos.image_router)
    app.include_router(events.router)
    app.include_router(meeting_sessions.router)
    app.include_router(quotes.router)
    app.include_router(contents.router)
    app.include_router(users.router)

    return app


app = create_app()

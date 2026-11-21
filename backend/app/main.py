"""Muneem API.

    cd backend
    .venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.agent.core import Agent
from app.agent.llm import build_backend
from app.api import bills, campaigns, chat, crm, data, findings, ingest, insights, inventory, restock, sheets
from app.config import get_settings
from app.store.manager import DataManager, NoDataset

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    m = DataManager(settings)
    m.startup()
    app.state.manager = m
    app.state.agent = Agent(m, build_backend(settings))
    m.sheets.start(settings.sheets_poll_minutes)
    yield
    m.sheets.stop()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Muneem API", version=__version__, lifespan=lifespan,
                  description="Kirana inventory & purchase intelligence. Every number is "
                              "computed in code; responses carry their formula.")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
        allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["*"],
    )

    @app.exception_handler(NoDataset)
    async def _no_data(_: Request, exc: NoDataset):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    app.include_router(data.router)
    app.include_router(insights.router)
    app.include_router(chat.router)
    app.include_router(restock.router)
    app.include_router(crm.router)
    app.include_router(findings.router)
    app.include_router(campaigns.router)
    app.include_router(ingest.router)
    app.include_router(sheets.router)
    app.include_router(bills.router)
    app.include_router(inventory.router)
    return app


app = create_app()

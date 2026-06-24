"""DT Orch setup installer API."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.routes import router

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title="DT Orch Installer", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok"}


if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        if full_path.startswith("api"):
            return {"detail": "Not found"}
        index = STATIC_DIR / "index.html"
        if index.is_file():
            return FileResponse(index)
        return {"detail": "Frontend not built"}


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("INSTALLER_HOST", "0.0.0.0")
    port = int(os.getenv("INSTALLER_PORT", "8080"))
    uvicorn.run("main:app", host=host, port=port, reload=False)

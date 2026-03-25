from fastapi import FastAPI

from .config import settings

app = FastAPI(title="DriveSense Python Engine (Deferred)")


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "py-engine",
        "env": settings.env,
        "status": "deferred",
    }


@app.get("/")
def root():
    return {
        "ok": True,
        "service": "py-engine",
        "status": "deferred",
        "note": "Optional future engine for heavy batch processing, embeddings, or document parsing.",
    }


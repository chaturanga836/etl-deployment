"""Minimal ELT scraper service — matches plugin provisioned POST /v1/scrape."""
from __future__ import annotations

import os
import re
import time
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="ELT Scraper Service", version="1.0.0")

VERIFY_URL = os.getenv("SCRAPER_VERIFY_URL", "").strip()
INTERNAL_TOKEN = os.getenv("SCRAPER_INTERNAL_TOKEN", "").strip()
DEFAULT_TIMEOUT = float(os.getenv("SCRAPER_TIMEOUT_SECONDS", "30"))


class ScrapeRequest(BaseModel):
    url: str
    extract: str = Field(default="text", description="text | links | html")
    wait_ms: int = 0
    render_js: bool = False


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._skip = 0
        self.parts: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[tuple]) -> None:
        if tag in ("script", "style", "noscript"):
            self._skip += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript") and self._skip:
            self._skip -= 1

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        text = data.strip()
        if text:
            self.parts.append(text)


def _extract_title(html: str) -> Optional[str]:
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    if not m:
        return None
    return re.sub(r"\s+", " ", m.group(1)).strip()


def _extract_links(html: str, base_url: str) -> List[str]:
    links: List[str] = []
    for m in re.finditer(r"""<a[^>]+href=["']([^"']+)["']""", html, re.I):
        href = m.group(1).strip()
        if href.startswith(("http://", "https://")):
            links.append(href)
    return links[:200]


def _plain_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    text = " ".join(parser.parts)
    return re.sub(r"\s+", " ", text).strip()


async def _verify_bearer(authorization: Optional[str], workspace_id: Optional[int]) -> None:
    if not VERIFY_URL:
        return
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Bearer token required")
    api_key = authorization.split(" ", 1)[1].strip()
    if not api_key:
        raise HTTPException(status_code=401, detail="Bearer token required")
    if workspace_id is None:
        raise HTTPException(status_code=400, detail="workspace_id query param required for verification")

    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if INTERNAL_TOKEN:
        headers["X-Internal-Token"] = INTERNAL_TOKEN

    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.post(
            VERIFY_URL,
            headers=headers,
            json={"workspace_id": workspace_id, "api_key": api_key},
        )
    if res.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid scraper API key")
    data = res.json()
    if not data.get("valid"):
        raise HTTPException(status_code=401, detail="Invalid scraper API key")


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/scrape")
async def scrape(
    body: ScrapeRequest,
    authorization: Optional[str] = Header(default=None),
    workspace_id: Optional[int] = None,
) -> Dict[str, Any]:
    await _verify_bearer(authorization, workspace_id)

    url = (body.url or "").strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="url must be http(s)")

    if body.render_js:
        raise HTTPException(status_code=501, detail="render_js is not supported in this build")

    if body.wait_ms > 0:
        time.sleep(min(body.wait_ms, 30_000) / 1000.0)

    try:
        async with httpx.AsyncClient(
            timeout=DEFAULT_TIMEOUT,
            follow_redirects=True,
            headers={"User-Agent": "ELT-Scraper/1.0"},
        ) as client:
            res = await client.get(url)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Fetch failed: {exc}") from exc

    html = res.text
    title = _extract_title(html)
    extract = (body.extract or "text").lower()

    if extract == "html":
        payload: Dict[str, Any] = {"url": str(res.url), "title": title, "html": html[:500_000]}
    elif extract == "links":
        payload = {"url": str(res.url), "title": title, "links": _extract_links(html, str(res.url))}
    else:
        payload = {
            "url": str(res.url),
            "title": title,
            "text": _plain_text(html)[:200_000],
            "links": _extract_links(html, str(res.url))[:50],
        }

    return {
        "success": res.is_success,
        "status_code": res.status_code,
        "data": payload,
    }

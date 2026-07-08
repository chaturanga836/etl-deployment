"""Deployment job state and SSE event bus."""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


@dataclass
class DeployJob:
    id: str
    status: JobStatus = JobStatus.PENDING
    login_url: str | None = None
    error: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    events: asyncio.Queue[dict[str, Any]] = field(default_factory=asyncio.Queue)
    log_lines: list[str] = field(default_factory=list)

    def push_log(self, line: str, *, prefix: str = "") -> None:
        text = f"{prefix}{line}".rstrip("\n")
        self.log_lines.append(text)
        self.events.put_nowait({"event": "log", "data": text})

    def push_phase(
        self,
        phase: str,
        *,
        label: str | None = None,
        progress: int | None = None,
    ) -> None:
        from app.deploy_phases import phase_payload

        payload = phase_payload(phase, label=label, progress=progress)
        self.events.put_nowait({"event": "phase", "data": payload})

    def complete(self, login_url: str) -> None:
        self.status = JobStatus.SUCCEEDED
        self.login_url = login_url
        self.events.put_nowait({"event": "complete", "data": {"login_url": login_url}})

    def fail(self, message: str) -> None:
        self.status = JobStatus.FAILED
        self.error = message
        self.events.put_nowait({"event": "error", "data": message})


_jobs: dict[str, DeployJob] = {}


def create_job() -> DeployJob:
    job_id = str(uuid.uuid4())
    job = DeployJob(id=job_id)
    _jobs[job_id] = job
    return job


def get_job(job_id: str) -> DeployJob | None:
    return _jobs.get(job_id)


def list_jobs() -> list[DeployJob]:
    return list(_jobs.values())

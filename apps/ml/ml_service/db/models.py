from __future__ import annotations

import os
from datetime import UTC, datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from ml_service.db.schema import resolve_db_schema

RAW_DATABASE_URL = os.getenv("AI_SERVICE_DATABASE_URL") or os.getenv("DATABASE_URL")
DB_SCHEMA = resolve_db_schema(os.getenv("AI_SERVICE_DB_SCHEMA"), RAW_DATABASE_URL)
JSONType = JSONB().with_variant(JSON(), "sqlite")


class Base(DeclarativeBase):
    __abstract__ = True


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        onupdate=lambda: datetime.now(UTC),
    )


class Project(Base, TimestampMixin):
    __tablename__ = "projects"
    __table_args__ = (
        Index("ix_projects_type_status_created_at", "project_type", "status", "created_at"),
        {"schema": DB_SCHEMA} if DB_SCHEMA else {},
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_type: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(512))
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    template_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONType, default=dict)
    settings_json: Mapped[dict] = mapped_column("settings", JSONType, default=dict)
    payload: Mapped[dict] = mapped_column(JSONType, default=dict)

    jobs: Mapped[list["Job"]] = relationship(back_populates="project")
    artifacts: Mapped[list["Artifact"]] = relationship(back_populates="project")


class Job(Base, TimestampMixin):
    __tablename__ = "jobs"
    __table_args__ = (
        Index("ix_jobs_type_idempotency_created_at", "type", "idempotency_key", "created_at"),
        Index("ix_jobs_project_status_created_at", "project_id", "status", "created_at"),
        {"schema": DB_SCHEMA} if DB_SCHEMA else {},
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    type: Mapped[str] = mapped_column(String(128), index=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    project_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey(f"{DB_SCHEMA + '.' if DB_SCHEMA else ''}projects.id"),
        nullable=True,
        index=True,
    )
    provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    input_ref: Mapped[dict] = mapped_column(JSONType, default=dict)
    result_ref: Mapped[dict] = mapped_column(JSONType, default=dict)
    error_json: Mapped[dict | None] = mapped_column("error", JSONType, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    project: Mapped[Project | None] = relationship(back_populates="jobs")
    artifacts: Mapped[list["Artifact"]] = relationship(back_populates="job")


class Artifact(Base, TimestampMixin):
    __tablename__ = "artifacts"
    __table_args__ = (
        Index("ix_artifacts_project_created_at", "project_id", "created_at"),
        Index("ix_artifacts_job_created_at", "job_id", "created_at"),
        {"schema": DB_SCHEMA} if DB_SCHEMA else {},
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(128), index=True)
    mime_type: Mapped[str] = mapped_column(String(255))
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    storage_uri: Mapped[str] = mapped_column(Text)
    checksum: Mapped[str | None] = mapped_column(String(128), nullable=True)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONType, default=dict)
    project_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey(f"{DB_SCHEMA + '.' if DB_SCHEMA else ''}projects.id"),
        nullable=True,
        index=True,
    )
    job_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey(f"{DB_SCHEMA + '.' if DB_SCHEMA else ''}jobs.id"),
        nullable=True,
        index=True,
    )

    project: Mapped[Project | None] = relationship(back_populates="artifacts")
    job: Mapped[Job | None] = relationship(back_populates="artifacts")

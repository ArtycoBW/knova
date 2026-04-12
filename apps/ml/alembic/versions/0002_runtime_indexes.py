from __future__ import annotations

from alembic import op

from ml_service.db.models import DB_SCHEMA


revision = "0002_runtime_indexes"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_projects_type_status_created_at",
        "projects",
        ["project_type", "status", "created_at"],
        schema=DB_SCHEMA,
    )
    op.create_index(
        "ix_jobs_type_idempotency_created_at",
        "jobs",
        ["type", "idempotency_key", "created_at"],
        schema=DB_SCHEMA,
    )
    op.create_index(
        "ix_jobs_project_status_created_at",
        "jobs",
        ["project_id", "status", "created_at"],
        schema=DB_SCHEMA,
    )
    op.create_index(
        "ix_artifacts_project_created_at",
        "artifacts",
        ["project_id", "created_at"],
        schema=DB_SCHEMA,
    )
    op.create_index(
        "ix_artifacts_job_created_at",
        "artifacts",
        ["job_id", "created_at"],
        schema=DB_SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("ix_artifacts_job_created_at", table_name="artifacts", schema=DB_SCHEMA)
    op.drop_index("ix_artifacts_project_created_at", table_name="artifacts", schema=DB_SCHEMA)
    op.drop_index("ix_jobs_project_status_created_at", table_name="jobs", schema=DB_SCHEMA)
    op.drop_index("ix_jobs_type_idempotency_created_at", table_name="jobs", schema=DB_SCHEMA)
    op.drop_index("ix_projects_type_status_created_at", table_name="projects", schema=DB_SCHEMA)

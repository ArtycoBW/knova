from __future__ import annotations

import time


def test_async_compare_job_completes_and_is_queryable(client):
    response = client.post(
        "/v1/tasks/compare",
        json={
            "documents": [{"text": "Alpha beta gamma."}, {"text": "Alpha delta epsilon."}],
            "execution": {"mode": "async"},
        },
    )
    assert response.status_code == 202
    job_id = response.json()["job"]["id"]

    status_payload = None
    for _ in range(30):
        status_response = client.get(f"/v1/jobs/{job_id}")
        assert status_response.status_code == 200
        status_payload = status_response.json()
        if status_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert status_payload is not None
    assert status_payload["status"] == "completed"
    assert "result" in status_payload["result_ref"]


def test_sync_quiz_and_table_tasks(client):
    quiz_response = client.post(
        "/v1/tasks/quiz",
        json={"prompt": "Data privacy basics", "question_count": 3, "execution": {"mode": "sync"}},
    )
    assert quiz_response.status_code == 200
    assert len(quiz_response.json()["questions"]) == 3

    table_response = client.post(
        "/v1/tasks/table",
        json={
            "sources": [{"text": "row one\nrow two"}],
            "target_columns": [{"key": "row", "label": "Row"}, {"key": "value", "label": "Value"}],
            "output_format": "markdown",
            "execution": {"mode": "sync"},
        },
    )
    assert table_response.status_code == 200
    assert len(table_response.json()["artifacts"]) == 1

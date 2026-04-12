from __future__ import annotations

import io


def test_presentation_project_lifecycle_and_export(client):
    create_response = client.post(
        "/v1/projects",
        json={
            "project_type": "presentation_project",
            "title": "Strategy Deck",
            "content": {
                "slides": [
                    {
                        "id": "slide_1",
                        "kind": "title",
                        "title": "Intro",
                        "subtitle": "Overview",
                        "blocks": [{"kind": "text", "data": {"content": "Hello"}}],
                    }
                ]
            },
        },
    )
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]

    add_slide_response = client.post(
        f"/v1/projects/{project_id}/slides",
        json={
            "slide": {
                "id": "slide_2",
                "kind": "content",
                "title": "Plan",
                "blocks": [{"kind": "bullet_list", "data": {"items": ["A", "B"]}}],
            }
        },
    )
    assert add_slide_response.status_code == 200
    assert len(add_slide_response.json()["slides"]) == 2

    export_response = client.post(
        f"/v1/projects/{project_id}/export",
        json={"formats": ["html"], "execution": {"mode": "sync"}},
    )
    assert export_response.status_code == 200
    artifacts = export_response.json()["artifacts"]
    assert artifacts

    artifact_id = artifacts[0]["id"]
    download_response = client.get(f"/v1/artifacts/{artifact_id}/download")
    assert download_response.status_code == 200
    assert b"<html" in download_response.content.lower()


def test_presentation_slide_reorder_and_regenerate_notes(client):
    create_response = client.post(
        "/v1/projects",
        json={
            "project_type": "presentation_project",
            "title": "Strategy Deck",
            "content": {
                "slides": [
                    {"id": "slide_1", "kind": "title", "title": "Intro", "speaker_notes": "Open strong", "blocks": []},
                    {"id": "slide_2", "kind": "content", "title": "Plan", "speaker_notes": "Explain plan", "blocks": []},
                ]
            },
        },
    )
    assert create_response.status_code == 200
    project_id = create_response.json()["id"]

    move_response = client.patch(
        f"/v1/projects/{project_id}/slides/slide_1",
        json={"move_after_slide_id": "slide_2"},
    )
    assert move_response.status_code == 200
    assert [slide["id"] for slide in move_response.json()["slides"]] == ["slide_2", "slide_1"]

    regenerate_response = client.post(
        f"/v1/projects/{project_id}/slides/slide_1/regenerate",
        json={"fields": ["speaker_notes"], "instructions": "more detail", "execution": {"mode": "sync"}},
    )
    assert regenerate_response.status_code == 200
    slide = next(slide for slide in regenerate_response.json()["slides"] if slide["id"] == "slide_1")
    assert slide["title"] == "Intro"
    assert "Adjusted: more detail" in slide["speaker_notes"]


def test_s3_storage_backend_keeps_artifact_api_contract(client_factory, monkeypatch):
    class FakeS3Client:
        def __init__(self):
            self.objects: dict[tuple[str, str], bytes] = {}

        def put_object(self, *, Bucket, Key, Body):
            self.objects[(Bucket, Key)] = bytes(Body)

        def get_object(self, *, Bucket, Key):
            return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}

        def head_bucket(self, *, Bucket):
            return {"Bucket": Bucket}

        def head_object(self, *, Bucket, Key):
            if (Bucket, Key) not in self.objects:
                raise FileNotFoundError(Key)
            return {}

    fake_s3 = FakeS3Client()
    monkeypatch.setattr("ml_service.storage.s3.boto3.session.Session.client", lambda self, *args, **kwargs: fake_s3)

    with client_factory(
        AI_SERVICE_STORAGE_BACKEND="s3",
        AI_SERVICE_S3_BUCKET="test-bucket",
        AI_SERVICE_S3_ACCESS_KEY_ID="key",
        AI_SERVICE_S3_SECRET_ACCESS_KEY="secret",
    ) as client:
        create_response = client.post(
            "/v1/projects",
            json={
                "project_type": "presentation_project",
                "title": "S3 Deck",
                "content": {
                    "slides": [
                        {"id": "slide_1", "kind": "title", "title": "Intro", "blocks": [{"kind": "text", "data": {"content": "Hello"}}]}
                    ]
                },
            },
        )
        assert create_response.status_code == 200
        project_id = create_response.json()["id"]

        export_response = client.post(
            f"/v1/projects/{project_id}/export",
            json={"formats": ["html"], "execution": {"mode": "sync"}},
        )
        assert export_response.status_code == 200
        artifact = export_response.json()["artifacts"][0]
        assert artifact["storage_uri"].startswith("s3://test-bucket/")

        download_response = client.get(f"/v1/artifacts/{artifact['id']}/download")
        assert download_response.status_code == 200
        assert b"<html" in download_response.content.lower()
        assert fake_s3.objects

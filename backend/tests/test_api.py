from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import main
from app.models import Base
from app.storage import get_db
from test_analysis import PAPERS


engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestSession = sessionmaker(bind=engine, expire_on_commit=False)


def override_db():
    with TestSession() as db:
        yield db


def test_map_endpoints(monkeypatch):
    Base.metadata.create_all(engine)
    main.app.dependency_overrides[get_db] = override_db

    async def fake_fetch(*_args):
        return PAPERS

    monkeypatch.setattr(main, "fetch_works", fake_fetch)
    try:
        with TestClient(main.app) as client:
            response = client.post("/api/maps", json={"query": "explainable ai", "limit": 20})
            assert response.status_code == 200, response.text
            data = response.json()
            assert len(data["points"]) == len(PAPERS)
            map_id = data["id"]
            again = client.post("/api/maps", json={"query": "explainable ai", "limit": 20})
            assert again.json()["cached"] is True
            assert again.json()["id"] == map_id
            loaded = client.get(f"/api/maps/{map_id}")
            assert loaded.status_code == 200
            rescaled = client.post(f"/api/maps/{map_id}/reweight", json={"weights": {"abstract": 0.1, "authors": 0.2, "citations": 0.7}})
            assert rescaled.status_code == 200, rescaled.text
            assert rescaled.json()["weights"]["citations"] == 0.7
            assert client.get(f"/api/maps/{map_id}").json()["weights"]["citations"] == 0.7
            assert client.get("/api/maps/not-exists").status_code == 404
            assert client.post("/api/maps", json={"query": "xx"}).status_code == 422
            assert client.post("/api/maps", json={"query": "valid", "weights": {"abstract": 0, "authors": 0, "citations": 0}}).status_code == 422
    finally:
        main.app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)

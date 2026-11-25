from app.openalex import decode_abstract, normalize_id, parse_work


def test_decode_inverted_abstract():
    assert decode_abstract({"research": [1, 3], "Good": [0], "is": [2]}) == "Good research is research"
    assert decode_abstract(None) == ""


def test_parse_work():
    item = parse_work({
        "id": "https://openalex.org/W123", "title": "A study", "publication_year": 2025,
        "cited_by_count": 17, "doi": "https://doi.org/10.abc/123",
        "abstract_inverted_index": {"A": [0], "study": [1]},
        "authorships": [{"author": {"id": "https://openalex.org/A1", "display_name": "Author One"}}],
        "referenced_works": ["https://openalex.org/W1"],
    })
    assert item["id"] == "W123"
    assert item["author_ids"] == ["A1"]
    assert item["referenced_works"] == ["W1"]
    assert normalize_id(item["url"]) == "W123"


def test_fetch_paginates_with_max_100(monkeypatch):
    import asyncio
    import httpx
    from app.openalex import fetch_works

    calls = []

    class FakeResponse:
        status_code = 200
        def __init__(self, page):
            self.page = page
        def json(self):
            start = (self.page - 1) * 100
            count = 100 if self.page == 1 else 20
            return {"results": [
                {"id": f"https://openalex.org/W{start+i+1}", "title": "topic",
                 "abstract_inverted_index": {"Abstract": [0]}, "referenced_works": []}
                for i in range(count)
            ]}

    class FakeClient:
        def __init__(self, **_kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *_args):
            pass
        async def get(self, url, params):
            assert url.startswith("https://api.openalex.org/")
            calls.append((params["page"], params["per_page"]))
            return FakeResponse(params["page"])

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    results = asyncio.run(fetch_works("explainable ai", 120, None, None))
    assert len(results) == 120
    assert calls == [(1, 100), (2, 100)]

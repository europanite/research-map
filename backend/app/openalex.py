"""Single-page OpenAlex search. Server-side key, no client exposure."""
import httpx

from .config import settings


class ProviderError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def decode_abstract(inverted: dict | None) -> str:
    if not inverted:
        return ""
    positioned = []
    for token, positions in inverted.items():
        if not isinstance(positions, list):
            continue
        for position in positions:
            if isinstance(position, int) and 0 <= position < 10000:
                positioned.append((position, token))
    return " ".join(token for _, token in sorted(positioned))


def normalize_id(value: str | None) -> str:
    return (value or "").rstrip("/").split("/")[-1]


def parse_work(raw: dict) -> dict:
    authors = []
    for item in raw.get("authorships") or []:
        author = item.get("author") or {}
        if author.get("display_name"):
            authors.append({"id": normalize_id(author.get("id")), "name": author["display_name"]})
    return {
        "id": normalize_id(raw.get("id")),
        "title": raw.get("title") or raw.get("display_name") or "Untitled",
        "abstract": decode_abstract(raw.get("abstract_inverted_index")),
        "year": raw.get("publication_year"),
        "cited_by_count": raw.get("cited_by_count") or 0,
        "authors": authors,
        "author_ids": [a["id"] for a in authors if a["id"]],
        "referenced_works": [normalize_id(v) for v in raw.get("referenced_works") or []],
        "doi": raw.get("doi"),
        "url": raw.get("id") or "",
    }


async def fetch_works(query: str, limit: int, year_from: int | None, year_to: int | None):
    filters = ["has_abstract:true"]
    if year_from:
        filters.append(f"from_publication_date:{year_from}-01-01")
    if year_to:
        filters.append(f"to_publication_date:{year_to}-12-31")
    params = {
        "search": query,
        "filter": ",".join(filters),
        "sort": "relevance_score:desc",
        "per_page": min(limit, 100),
        "page": 1,
        "select": "id,title,display_name,publication_year,cited_by_count,authorships,referenced_works,abstract_inverted_index,doi",
    }
    if settings.openalex_api_key:
        params["api_key"] = settings.openalex_api_key
    if settings.openalex_email:
        params["mailto"] = settings.openalex_email
    seen = set()
    papers = []
    try:
        async with httpx.AsyncClient(timeout=settings.openalex_timeout_seconds) as client:
            for page in range(1, 1 + (limit + 99) // 100):
                params["page"] = page
                response = await client.get("https://api.openalex.org/works", params=params)
                if response.status_code in (429, 402):
                    raise ProviderError("OpenAlex API budget or request limit reached. Configure OPENALEX_API_KEY or retry after quota resets.", 429)
                if response.status_code >= 400:
                    raise ProviderError(f"OpenAlex returned HTTP {response.status_code}.")
                try:
                    payload = response.json()
                except ValueError as exc:
                    raise ProviderError("OpenAlex returned invalid JSON.") from exc
                results = payload.get("results", [])
                if not isinstance(results, list):
                    raise ProviderError("OpenAlex response did not contain a work list.")
                for raw in results:
                    paper = parse_work(raw)
                    if not paper["id"] or paper["id"] in seen or not paper["abstract"]:
                        continue
                    papers.append(paper)
                    seen.add(paper["id"])
                    if len(papers) >= limit:
                        break
                if len(papers) >= limit or len(results) < params["per_page"]:
                    break
    except httpx.TimeoutException as exc:
        raise ProviderError("OpenAlex timed out. Please try again.", 504) from exc
    except httpx.RequestError as exc:
        raise ProviderError("Could not connect to OpenAlex.") from exc
    return papers

"""Research Map REST API; anonymous MVP. Billing/auth are intentionally not active."""
import hashlib
import json
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .analysis import build_map
from .config import settings
from .models import MapRun, Paper, UsageEvent, utcnow
from .openalex import ProviderError, fetch_works
from .schemas import MapResponse, ReweightRequest, SearchRequest
from .storage import get_db, init_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Research Map API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _cache_key(request: SearchRequest) -> str:
    # Papers are identical across all weight settings, so omit weights.
    value = {"q": request.query.lower(), "limit": request.limit, "from": request.year_from, "to": request.year_to, "v": 2}
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def _serialize(run: MapRun, *, cached: bool = False) -> MapResponse:
    return MapResponse(
        id=run.id, query=run.query, year_from=run.year_from, year_to=run.year_to,
        requested_limit=run.requested_limit, weights=run.weights, points=run.points,
        edges=run.edges, metrics=run.metrics,
        created_at=run.created_at.isoformat(), cached=cached,
        embedding_method=run.metrics.get("embedding_method", "unknown"),
    )


def _get_papers(db: Session, paper_ids: list[str]) -> list[dict]:
    if not paper_ids:
        return []
    rows = db.scalars(select(Paper).where(Paper.id.in_(paper_ids))).all()
    by_id = {r.id: r for r in rows}
    papers = []
    for paper_id in paper_ids:
        r = by_id.get(paper_id)
        if r is None:
            continue
        papers.append({
            "id": r.id, "title": r.title, "abstract": r.abstract, "year": r.year,
            "cited_by_count": r.cited_by_count, "authors": r.authors,
            "author_ids": r.author_ids, "referenced_works": r.referenced_works,
            "doi": r.doi, "url": r.url,
        })
    return papers


def _save_papers(db: Session, papers: list[dict]):
    for p in papers:
        existing = db.get(Paper, p["id"])
        if existing is None:
            existing = Paper(id=p["id"], title=p["title"], url=p["url"])
            db.add(existing)
        for key in ("title", "abstract", "year", "cited_by_count", "authors", "author_ids", "referenced_works", "doi", "url"):
            setattr(existing, key, p[key])
    db.flush()


def _ip_hash(request: Request) -> str:
    # Deliberately ignore user-provided X-Forwarded-For until a trusted proxy is configured.
    ip = request.client.host if request.client else "unknown"
    return hashlib.sha256((settings.usage_hash_salt + ":" + ip).encode()).hexdigest()


@app.get("/api/health")
def health():
    return {"status": "ok", "version": app.version}


@app.post("/api/maps", response_model=MapResponse)
async def search_map(body: SearchRequest, request: Request, db: Session = Depends(get_db)):
    key = _cache_key(body)
    newest = db.scalars(select(MapRun).where(MapRun.cache_key == key).order_by(MapRun.created_at.desc())).first()
    now = utcnow()
    papers = []
    cached = False
    if newest:
        age = now - _aware(newest.provider_fetched_at)
        if age < timedelta(hours=settings.cache_ttl_hours):
            papers = _get_papers(db, newest.paper_ids)
            cached = len(papers) == len(newest.paper_ids)
            # Can reuse the entire result if weights are unchanged; no recomputation needed.
            if cached and body.weights.model_dump() == newest.weights:
                return _serialize(newest, cached=True)
    if not cached:
        ip_hash = _ip_hash(request)
        if settings.guest_daily_search_limit > 0:
            since = now - timedelta(days=1)
            used = db.scalar(select(func.count()).select_from(UsageEvent).where(
                UsageEvent.ip_hash == ip_hash, UsageEvent.action == "provider_search", UsageEvent.created_at >= since
            )) or 0
            if used >= settings.guest_daily_search_limit:
                raise HTTPException(status_code=429, detail="Daily search quota reached. Cached maps remain available.")
        try:
            papers = await fetch_works(body.query, body.limit, body.year_from, body.year_to)
        except ProviderError as exc:
            # If the provider is rate-limited, provide the last snapshot if available.
            if newest:
                papers = _get_papers(db, newest.paper_ids)
                cached = bool(papers)
            if not cached:
                raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        if not papers:
            raise HTTPException(status_code=404, detail="No papers with abstracts were found. Try a broader query.")
        if not cached:
            _save_papers(db, papers)
            db.add(UsageEvent(ip_hash=ip_hash, action="provider_search"))
            db.flush()
    try:
        points, edges, metrics = await build_map(papers, body.weights.model_dump())
    except ProviderError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    if cached:
        metrics["stale_provider_fallback"] = bool(newest and (now - _aware(newest.provider_fetched_at)) >= timedelta(hours=settings.cache_ttl_hours))
    run = MapRun(
        query=body.query, year_from=body.year_from, year_to=body.year_to,
        requested_limit=body.limit, weights=body.weights.model_dump(),
        paper_ids=[p["id"] for p in papers], points=points, edges=edges,
        metrics=metrics, cache_key=key,
        provider_fetched_at=newest.provider_fetched_at if cached and newest else now,
    )
    db.add(run)
    db.commit()
    return _serialize(run, cached=cached)


@app.get("/api/maps/{map_id}", response_model=MapResponse)
def get_map(map_id: str, db: Session = Depends(get_db)):
    run = db.get(MapRun, map_id)
    if not run:
        raise HTTPException(status_code=404, detail="Map not found")
    return _serialize(run, cached=True)


@app.post("/api/maps/{map_id}/reweight", response_model=MapResponse)
async def reweight_map(map_id: str, body: ReweightRequest, db: Session = Depends(get_db)):
    run = db.get(MapRun, map_id)
    if not run:
        raise HTTPException(status_code=404, detail="Map not found")
    papers = _get_papers(db, run.paper_ids)
    if len(papers) != len(run.paper_ids):
        raise HTTPException(status_code=409, detail="Cached papers are incomplete")
    try:
        points, edges, metrics = await build_map(papers, body.weights.model_dump())
    except ProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    run.weights = body.weights.model_dump()
    run.points = points
    run.edges = edges
    run.metrics = metrics
    run.updated_at = utcnow()
    db.commit()
    return _serialize(run, cached=True)

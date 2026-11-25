from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Weights(BaseModel):
    abstract: float = Field(default=0.65, ge=0, le=1)
    authors: float = Field(default=0.15, ge=0, le=1)
    citations: float = Field(default=0.20, ge=0, le=1)

    @model_validator(mode="after")
    def not_all_zero(self):
        if self.abstract + self.authors + self.citations <= 0:
            raise ValueError("At least one similarity weight must be positive")
        return self


class SearchRequest(BaseModel):
    query: str = Field(min_length=3, max_length=200)
    limit: int = Field(default=60, ge=5, le=120)
    year_from: int | None = Field(default=None, ge=1850, le=2100)
    year_to: int | None = Field(default=None, ge=1850, le=2100)
    weights: Weights = Field(default_factory=Weights)

    @model_validator(mode="after")
    def year_order(self):
        self.query = " ".join(self.query.split())
        if self.year_from and self.year_to and self.year_from > self.year_to:
            raise ValueError("year_from cannot be after year_to")
        return self


class ReweightRequest(BaseModel):
    weights: Weights


class AuthorOut(BaseModel):
    id: str
    name: str


class PaperOut(BaseModel):
    id: str
    title: str
    abstract: str
    year: int | None
    cited_by_count: int
    authors: list[AuthorOut]
    doi: str | None
    url: str


class MapPoint(BaseModel):
    id: str
    x: float
    y: float
    z: float
    cluster: int
    paper: PaperOut


class MapEdge(BaseModel):
    source: str
    target: str
    kind: Literal["citation", "similarity"]
    strength: float


class MapResponse(BaseModel):
    id: str
    query: str
    year_from: int | None
    year_to: int | None
    requested_limit: int
    weights: Weights
    points: list[MapPoint]
    edges: list[MapEdge]
    metrics: dict
    created_at: str
    cached: bool = False
    embedding_method: str

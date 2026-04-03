from fastapi import FastAPI
from pydantic import BaseModel, Field

from app.scoring import analyze_payload


app = FastAPI(title="SecuAI Analyzer", version="0.2.0")


class RequestLogInput(BaseModel):
    method: str = Field(min_length=1, max_length=16)
    host: str = Field(min_length=1, max_length=255)
    path: str = Field(min_length=1, max_length=2048)
    query_string: str | None = Field(default=None, max_length=4096)
    status_code: int | None = Field(default=None, ge=100, le=599)
    client_ip: str | None = Field(default=None, max_length=64)
    user_agent: str | None = Field(default=None, max_length=2048)
    referer: str | None = Field(default=None, max_length=2048)
    metadata: dict[str, object] | None = None


class AttackEventInput(BaseModel):
    event_type: str = Field(min_length=1, max_length=64)
    severity: str = Field(min_length=1, max_length=16)
    summary: str = Field(min_length=1, max_length=4096)
    details: dict[str, object] | None = None


class AnalyzeRequest(BaseModel):
    request_log: RequestLogInput
    attack_event: AttackEventInput | None = None


class AnalyzeResponse(BaseModel):
    riskScore: int = Field(ge=0, le=100)
    riskLevel: str
    reasons: list[str]


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "ai-analyzer", "status": "ok"}


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(payload: AnalyzeRequest) -> AnalyzeResponse:
    result = analyze_payload(payload.model_dump())
    return AnalyzeResponse(**result)

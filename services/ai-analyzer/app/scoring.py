from __future__ import annotations

from typing import Any


SQLI_TOKENS = (
    "union select",
    "' or 1=1",
    "\" or 1=1",
    "drop table",
    "information_schema",
    "sleep(",
    "benchmark(",
    "select * from",
)

XSS_TOKENS = (
    "<script",
    "%3cscript",
    "javascript:",
    "onerror=",
    "onload=",
    "alert(",
    "document.cookie",
)

SUSPICIOUS_USER_AGENTS = (
    "sqlmap",
    "nikto",
    "acunetix",
    "masscan",
    "nmap",
    "wpscan",
    "gobuster",
    "dirbuster",
)

SENSITIVE_PATH_TOKENS = (
    "/admin",
    "/login",
    "/wp-admin",
    "/wp-login.php",
    "/phpmyadmin",
    "/.env",
)


def _normalize_text(*parts: object) -> str:
    text_parts = [str(part).lower() for part in parts if part not in (None, "")]
    return " ".join(text_parts)


def _matched_tokens(text: str, tokens: tuple[str, ...]) -> list[str]:
    return [token for token in tokens if token in text]


def _append_reason(reasons: list[str], reason: str) -> None:
    if reason not in reasons:
        reasons.append(reason)


def _risk_level(score: int) -> str:
    if score >= 70:
        return "high"
    if score >= 40:
        return "medium"
    return "low"


def analyze_payload(payload: dict[str, Any]) -> dict[str, Any]:
    request_log = payload["request_log"]
    attack_event = payload.get("attack_event")
    reasons: list[str] = []
    score = 10

    request_text = _normalize_text(
        request_log.get("method"),
        request_log.get("host"),
        request_log.get("path"),
        request_log.get("query_string"),
        request_log.get("user_agent"),
        request_log.get("referer"),
    )

    matched_sqli_tokens = _matched_tokens(request_text, SQLI_TOKENS)
    if matched_sqli_tokens:
        score += 35
        _append_reason(
            reasons,
            f"Matched SQL injection indicators: {', '.join(matched_sqli_tokens)}."
        )

    matched_xss_tokens = _matched_tokens(request_text, XSS_TOKENS)
    if matched_xss_tokens:
        score += 30
        _append_reason(
            reasons,
            f"Matched XSS payload fragments: {', '.join(matched_xss_tokens)}."
        )

    user_agent = _normalize_text(request_log.get("user_agent"))
    matched_user_agent_tokens = _matched_tokens(user_agent, SUSPICIOUS_USER_AGENTS)
    if matched_user_agent_tokens:
        score += 20
        _append_reason(
            reasons,
            f"Suspicious scanning user-agent detected: {', '.join(matched_user_agent_tokens)}."
        )

    path = _normalize_text(request_log.get("path"))
    matched_sensitive_paths = _matched_tokens(path, SENSITIVE_PATH_TOKENS)
    if matched_sensitive_paths:
        score += 10
        _append_reason(
            reasons,
            f"Request targeted sensitive paths: {', '.join(matched_sensitive_paths)}."
        )

    status_code = request_log.get("status_code")
    if isinstance(status_code, int) and status_code >= 500:
        score += 10
        _append_reason(
            reasons,
            f"Server returned abnormal status code {status_code}, which can indicate probing or exploit attempts."
        )
    elif isinstance(status_code, int) and status_code in (401, 403, 404):
        score += 5
        _append_reason(
            reasons,
            f"Response status code {status_code} is commonly seen during probing or unauthorized access attempts."
        )

    metadata = request_log.get("metadata") or {}
    if isinstance(metadata, dict):
        recent_request_count = metadata.get("recentRequestCount")
        if isinstance(recent_request_count, int) and recent_request_count >= 5:
            score += 20
            _append_reason(
                reasons,
                f"Recent request count {recent_request_count} exceeded the simplified high-frequency threshold."
            )

    if attack_event:
        event_text = _normalize_text(
            attack_event.get("event_type"),
            attack_event.get("severity"),
            attack_event.get("summary"),
            attack_event.get("details"),
        )

        event_type = _normalize_text(attack_event.get("event_type"))
        if "sql_injection" in event_type:
            score += 15
            _append_reason(reasons, "Attack event type indicates a SQL injection finding.")
        if "xss" in event_type:
            score += 15
            _append_reason(reasons, "Attack event type indicates an XSS finding.")
        if "high_frequency" in event_type:
            score += 10
            _append_reason(reasons, "Attack event indicates abnormally high access frequency.")
        if "suspicious_user_agent" in event_type:
            score += 10
            _append_reason(reasons, "Attack event indicates a suspicious scanning user-agent.")

        severity = _normalize_text(attack_event.get("severity"))
        if severity == "critical":
            score += 15
            _append_reason(reasons, "Attack event severity is critical.")
        elif severity == "high":
            score += 10
            _append_reason(reasons, "Attack event severity is high.")
        elif severity == "medium":
            score += 5
            _append_reason(reasons, "Attack event severity is medium.")

        if "admin" in event_text or "login" in event_text:
            score += 5
            _append_reason(reasons, "Attack event context references a sensitive access path.")

    score = max(0, min(score, 100))
    risk_level = _risk_level(score)

    if not reasons:
        reasons.append("No strong attack indicators were matched by the current heuristic rules.")

    return {
        "riskScore": score,
        "riskLevel": risk_level,
        "reasons": reasons,
    }

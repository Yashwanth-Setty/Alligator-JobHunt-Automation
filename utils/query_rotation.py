"""Role bucket rotation and query history persistence."""
import os
import sqlite3
from datetime import datetime

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DB_PATH = os.path.join(BASE, "jobs.db")

ROLE_BUCKETS = {
    "backend_java": [
        "Senior Java Developer",
        "Java Backend Engineer",
        "Spring Boot Developer",
        "Java Microservices Developer",
        "AWS Java Developer",
    ],
    "full_stack": [
        "Senior Full Stack Developer",
        "Java Full Stack Developer",
        "React Java Developer",
        "Node.js Backend Engineer",
    ],
    "ai_software": [
        "AI Software Engineer",
        "Backend Engineer AI Platform",
        "GenAI Engineer",
        "LLM Application Engineer",
        "RAG Engineer",
    ],
    "cloud_api": [
        "Cloud Backend Engineer",
        "API Engineer",
        "Platform Engineer",
        "Enterprise Integration Engineer",
    ],
}


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS query_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT,
            bucket TEXT,
            query TEXT,
            used_at TEXT
        )
        """
    )
    conn.commit()
    return conn


def detect_role_category(title: str = "", description: str = "") -> str:
    text = f"{title} {description}".lower()
    if any(k in text for k in ("ai ", "llm", "rag", "genai", "machine learning", "ml engineer")):
        return "ai_software"
    if any(k in text for k in ("full stack", "full-stack", "fullstack", "react java")):
        return "full_stack"
    if any(k in text for k in ("cloud", "api engineer", "platform engineer", "integration")):
        return "cloud_api"
    return "backend_java"


def get_rotated_queries(source: str) -> tuple[str, list[str]]:
    """Rotate through buckets per source and return selected query list."""
    buckets = list(ROLE_BUCKETS.keys())
    conn = _conn()
    try:
        used = conn.execute(
            "SELECT COUNT(*) FROM query_history WHERE source=?",
            (source,),
        ).fetchone()[0]
        bucket_idx = used % len(buckets)
        bucket_name = buckets[bucket_idx]
        queries = ROLE_BUCKETS[bucket_name]
        now = datetime.now().isoformat()
        for q in queries:
            conn.execute(
                "INSERT INTO query_history(source, bucket, query, used_at) VALUES(?,?,?,?)",
                (source, bucket_name, q, now),
            )
        conn.commit()
        return bucket_name, queries
    finally:
        conn.close()

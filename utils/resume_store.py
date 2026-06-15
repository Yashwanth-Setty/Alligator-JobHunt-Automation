"""Secure resume upload, replace, and delete — files stay in gitignored resumes/."""
import os
import shutil
from datetime import datetime

from utils.db_schema import init_dashboard_schema
from utils.apply_db import get_connection

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RESUMES_DIR = os.path.join(BASE, "resumes")
ALLOWED_EXT = {".pdf", ".docx"}


def _ensure_dir() -> None:
    os.makedirs(RESUMES_DIR, exist_ok=True)


def get_active_resume() -> dict | None:
    init_dashboard_schema()
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM resume_profiles WHERE is_active=1 ORDER BY uploaded_at DESC LIMIT 1"
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def list_resumes() -> list[dict]:
    init_dashboard_schema()
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM resume_profiles ORDER BY uploaded_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def save_uploaded_resume(file_name: str, file_bytes: bytes) -> dict:
    _ensure_dir()
    ext = os.path.splitext(file_name)[1].lower()
    if ext not in ALLOWED_EXT:
        raise ValueError(f"Unsupported file type '{ext}'. Use PDF or DOCX.")

    safe_name = f"resume{ext}"
    dest = os.path.join(RESUMES_DIR, safe_name)
    with open(dest, "wb") as f:
        f.write(file_bytes)

    os.environ["APPLICANT_RESUME_PATH"] = dest

    now = datetime.now().isoformat()
    init_dashboard_schema()
    conn = get_connection()
    try:
        conn.execute("UPDATE resume_profiles SET is_active=0")
        conn.execute(
            "INSERT INTO resume_profiles "
            "(file_name, file_path, file_type, file_size, uploaded_at, is_active) "
            "VALUES (?,?,?,?,?,1)",
            (file_name, dest, ext.lstrip("."), len(file_bytes), now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM resume_profiles WHERE is_active=1 ORDER BY id DESC LIMIT 1"
        ).fetchone()
    finally:
        conn.close()

    _invalidate_resume_cache()
    return dict(row) if row else {"file_path": dest, "file_name": file_name}


def delete_active_resume() -> bool:
    profile = get_active_resume()
    if not profile:
        return False
    path = profile.get("file_path", "")
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass
    conn = get_connection()
    try:
        conn.execute("UPDATE resume_profiles SET is_active=0 WHERE id=?", (profile["id"],))
        conn.commit()
    finally:
        conn.close()
    _invalidate_resume_cache()
    return True


def _invalidate_resume_cache() -> None:
    for name in ("resume_cache.json", "resume_cache.txt"):
        path = os.path.join(BASE, name)
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass


def resume_status_summary() -> dict:
    profile = get_active_resume()
    if not profile:
        env_path = os.environ.get("APPLICANT_RESUME_PATH", "").strip()
        if env_path and os.path.exists(env_path):
            return {
                "loaded": True,
                "file_name": os.path.basename(env_path),
                "file_path": env_path,
                "source": "env",
            }
        fallback = os.path.join(RESUMES_DIR, "resume.pdf")
        if os.path.exists(fallback):
            return {
                "loaded": True,
                "file_name": "resume.pdf",
                "file_path": fallback,
                "source": "disk",
            }
        return {"loaded": False, "error": "No resume uploaded. Upload a PDF or DOCX."}

    path = profile.get("file_path", "")
    return {
        "loaded": os.path.exists(path),
        "file_name": profile.get("file_name", ""),
        "file_path": path,
        "uploaded_at": profile.get("uploaded_at", ""),
        "file_type": profile.get("file_type", ""),
        "file_size": profile.get("file_size", 0),
        "source": "upload",
    }

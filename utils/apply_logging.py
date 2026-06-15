"""Centralized logging for packet generation and apply agent."""
import logging
import os
from logging.handlers import RotatingFileHandler

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LOG_DIR = os.path.join(BASE, "logs")
os.makedirs(LOG_DIR, exist_ok=True)

LAST_PACKET_ERROR = os.path.join(LOG_DIR, "last_packet_error.txt")
LAST_APPLY_ERROR = os.path.join(LOG_DIR, "last_apply_error.txt")


def _setup(name: str, filename: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(logging.DEBUG)
    path = os.path.join(LOG_DIR, filename)
    handler = RotatingFileHandler(path, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(handler)
    logger.addHandler(logging.StreamHandler())
    return logger


packet_log = _setup("alligator.packet", "packet_generation.log")
apply_log = _setup("alligator.apply_agent", "apply_agent.log")


def record_packet_error(msg: str) -> None:
    with open(LAST_PACKET_ERROR, "w", encoding="utf-8") as f:
        f.write(msg)


def record_apply_error(msg: str) -> None:
    with open(LAST_APPLY_ERROR, "w", encoding="utf-8") as f:
        f.write(msg)


def read_last_packet_error() -> str:
    try:
        return open(LAST_PACKET_ERROR, encoding="utf-8").read().strip()
    except OSError:
        return ""


def read_last_apply_error() -> str:
    try:
        return open(LAST_APPLY_ERROR, encoding="utf-8").read().strip()
    except OSError:
        return ""

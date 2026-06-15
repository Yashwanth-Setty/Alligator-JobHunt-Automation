"""Reusable OpenAI client with primary/fallback model support."""
import logging
import os

from openai import OpenAI

log = logging.getLogger("alligator_apply")

PRIMARY_MODEL = "gpt-5"
FALLBACK_MODEL = "gpt-4.1-mini"

_client = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise ValueError("OPENAI_API_KEY not set")
        _client = OpenAI(api_key=api_key)
    return _client


def complete(messages, **kwargs) -> str:
    """Run a chat completion, falling back if the primary model fails."""
    client = get_client()
    last_error = None

    for model in (PRIMARY_MODEL, FALLBACK_MODEL):
        call_kwargs = dict(kwargs)
        if model.startswith("gpt-5") and "temperature" in call_kwargs:
            call_kwargs.pop("temperature")
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                **call_kwargs,
            )
            content = response.choices[0].message.content
            return (content or "").strip()
        except Exception as e:
            last_error = e
            log.warning("OpenAI %s failed: %s", model, e)

    raise last_error or RuntimeError("OpenAI completion failed")

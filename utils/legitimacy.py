import re

TECH_TERMS = [
    "python", "docker", "kubernetes", "aws", "gcp", "sagemaker",
    "tensorflow", "pytorch", "sql", "spark", "kafka", "databricks",
    "huggingface", "langchain", "chroma", "faiss", "pinecone",
    "weaviate",
]


def score_legitimacy(job) -> str:
    if not isinstance(job, dict):
        return "low"

    url = str(job.get("url", "") or "").lower()
    description = str(job.get("description", "") or "").lower()
    points = 0

    if any(provider in url for provider in ("greenhouse", "lever", "ashby")):
        points += 2

    if re.search(r"\$\s*\d|salary|annual|per year|compensation|pay range|pay:", description):
        points += 1

    if " team" in description or description.startswith("team") or "team of" in description:
        points += 1

    tech_count = sum(1 for term in TECH_TERMS if term in description)
    if tech_count >= 2:
        points += 1

    if len(description.strip()) < 200:
        points -= 1

    if points >= 4:
        return "high"
    if points >= 2:
        return "medium"
    return "low"

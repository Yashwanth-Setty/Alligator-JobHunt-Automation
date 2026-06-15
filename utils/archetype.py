def detect_archetype(job) -> str:
    if not isinstance(job, dict):
        return "general"

    title = str(job.get("title", "") or "").lower()
    description = str(job.get("description", "") or "").lower()
    text = f"{title} {description}".strip()
    if not text:
        return "general"

    archetypes = [
        (
            "agentic",
            [
                "agentic",
                "autonomous agent",
                "autonomous agents",
                "agent-based",
                "agent based",
                "decision agent",
                "decision-making agent",
            ],
        ),
        (
            "llmops",
            [
                "llmops",
                "llm ops",
                "prompt engineering",
                "prompt engineer",
                "prompting",
                "llm operations",
                "langchain",
            ],
        ),
        (
            "mlops",
            [
                "mlops",
                "ml ops",
                "model ops",
                "ml platform",
                "model platform",
                "sagemaker",
                "kubeflow",
                "mlflow",
                "airflow",
            ],
        ),
        (
            "multimodal",
            [
                "multimodal",
                "vision-language",
                "vision language",
                "image and text",
                "audio",
                "video",
                "speech",
                "clip",
                "vision",
            ],
        ),
        (
            "rag",
            [
                "rag",
                "retrieval-augmented",
                "retrieval augmented",
                "retrieval",
                "vector database",
                "semantic search",
                "chroma",
                "faiss",
                "pinecone",
                "weaviate",
            ],
        ),
        (
            "platform",
            [
                "platform",
                "platform team",
                "ai platform",
                "ml platform",
                "data platform",
                "infrastructure platform",
                "platform engineer",
                "production platform",
            ],
        ),
    ]

    best_name = "general"
    best_score = 0
    for name, keywords in archetypes:
        score = 0
        for keyword in keywords:
            if keyword in text:
                score += 1
        if score > best_score:
            best_score = score
            best_name = name

    return best_name if best_score > 0 else "general"

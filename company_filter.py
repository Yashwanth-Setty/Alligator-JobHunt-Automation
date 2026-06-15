WHITELIST = {
    "anthropic","scale ai","scaleai","openai",
    "cohere","hugging face","huggingface",
    "weights & biases","wandb","langchain",
    "pinecone","weaviate","databricks",
    "replicate","modal","together ai","mistral",
    "deepgram","elevenlabs","runway","pnc",
    "capital one","jpmorgan","google","amazon",
    "microsoft","apple","meta","nvidia",
    "kkr","at&t","att"
}

BLOCK_PATTERNS = [
    " llc"," inc"," corp",
    "staffing","recruiting","placement",
    "it solutions","consulting","manpower",
    "resource group","talent solutions",
    "outsourcing","offshore","body shop"
]

def is_company_ok(job):
    name = job.get("company","").lower().strip()
    if not name:
        return True
    for w in WHITELIST:
        if w in name:
            return True
    for p in BLOCK_PATTERNS:
        if name.endswith(p) or p in name:
            return False
    return True

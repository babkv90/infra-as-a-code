# Central config for this service, loaded once at import time from services/agents/.env (falling
# back to the defaults below when a var is unset — those defaults are dev-only placeholders, not
# safe for a real deployment). Import `settings` from here rather than reading os.environ directly.
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str = ""  # unset/placeholder means has_real_api_key() in agents/base.py returns False
    openai_agent_model: str = "gpt-4o-mini"  # model every specialist and the router call by default
    agent_tool_secret: str = "dev-agent-tool-secret-change-me"  # must match Express's AGENT_TOOL_SECRET — verifies the machine JWT in app/security.py
    express_internal_url: str = "http://127.0.0.1:4001/api/v1"  # base URL app/gateway.py calls back into (grounding, run-step, run-complete)

    # RAG knowledge base (app/rag/). Empty database_url disables the whole feature: ingestion calls
    # 400 and retrieval is skipped, so a run still works without a configured Postgres.
    database_url: str = ""  # postgresql://user:pass@host:5432/dbname  — Postgres 14+ with the `vector` extension
    rag_embed_model: str = "text-embedding-3-small"  # 1536-dim; keep in sync with the vector(N) column in the schema
    rag_embed_dim: int = 1536
    rag_top_k: int = 6  # chunks pulled into a run's grounding context
    rag_chunk_chars: int = 1200  # ~300 tokens per chunk
    rag_chunk_overlap: int = 150
    rag_max_document_bytes: int = 6_000_000  # sync Lambda invoke payload ceiling is 6 MB


settings = Settings()

"""Retrieval-augmented grounding for the multi-agent service.

A super admin uploads documents through the Express dashboard; Express hands the raw bytes to this
service (Lambda `op: "rag.ingest"`, or POST /rag/documents in local dev), which extracts text,
chunks it, embeds each chunk with OpenAI, and stores the vectors in Postgres + pgvector. On every
run, `graph.ground_node` embeds the question and pulls the top-k chunks into the grounding context
every specialist sees.

The whole feature is inert when `settings.database_url` is empty — ingestion 400s and retrieval is
skipped, so the service still runs without a Postgres configured.
"""

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


settings = Settings()

# The "make it pass terraform plan" agent: an open-ended tool-calling loop (agent.py) that edits a
# draft copy of the diagram and runs real `terraform plan`s until one passes or it decides to stop.
# Unlike app/graph.py's fixed workflow, the model chooses every next step here — Express
# (IAAS backend/src/services/agentPlanFix.js) only enforces the guardrails around it.

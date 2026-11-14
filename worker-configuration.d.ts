interface Env {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  LLM_PROVIDER?: 'anthropic' | 'openai-compatible';
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_API_KEY?: string;
  EXECUTOR_URL?: string;
  EXECUTOR_TOKEN?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  EXECUTOR_WORKSPACE_ACL?: string;
}

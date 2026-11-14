/** Application capability checks only. This module never invokes OS sudo. */
export enum SudoPrivilege {
  NONE = 0,
  ELEVATED = 1,
  SYSTEM = 2,

  /** Deprecated labels retained for source compatibility; grants are rejected. */
  ROOT = 3,
  GODMODE = 4,
}

export interface SudoCapability {
  name: string;
  description: string;
  privilege: SudoPrivilege;
  enabled: boolean;
}
export interface SudoAuditEntry {
  timestamp: number;
  action: string;
  privilege: SudoPrivilege;
  target: string;
  result: 'success' | 'denied' | 'error';
  details?: string;
}
export interface SudoSession {
  id: string;
  agentId: string;
  privilege: SudoPrivilege;
  grantedAt: number;
  expiresAt: number;
  reason: string;
  capabilities: SudoCapability[];
  auditLog: SudoAuditEntry[];
  allowedOperations: string[];
}
export const DEFAULT_SUDO_CAPABILITIES: SudoCapability[] = [];

const MAX_SESSION_MS = 5 * 60 * 1000;

/** Local, bounded diagnostic audit. Durable execution auditing belongs to the runner. */
export class SudoManager {
  private sessions = new Map<string, SudoSession>();
  private auditLog: SudoAuditEntry[] = [];

  grantSudo(
    agentId: string,
    privilege = SudoPrivilege.ELEVATED,
    reason = 'Explicit scoped application capability',
    duration = 60_000,
    allowedOperations: string[] = [],
  ): SudoSession {
    if (
      !agentId ||
      !Number.isInteger(privilege) ||
      privilege < 1 ||
      privilege > SudoPrivilege.SYSTEM ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > MAX_SESSION_MS ||
      !allowedOperations.length ||
      allowedOperations.some((op) => !/^[a-z][a-z0-9_]{0,63}$/.test(op))
    ) {
      this.audit('grant_sudo', privilege, agentId, 'denied', 'Invalid or unrestricted grant');
      throw new Error('Elevation requires a finite, explicitly scoped capability; ROOT/GODMODE are unsupported');
    }

    if (this.sessions.size >= 256 && !this.sessions.has(agentId)) {
      throw new Error('Capability session limit reached');
    }

    const now = Date.now();
    const session: SudoSession = {
      id: `cap_${crypto.randomUUID()}`,
      agentId,
      privilege,
      grantedAt: now,
      expiresAt: now + duration,
      reason,
      capabilities: [],
      auditLog: [],
      allowedOperations: [...new Set(allowedOperations)],
    };
    this.sessions.set(agentId, session);
    this.audit('grant_sudo', privilege, agentId, 'success');

    return structuredClone(session);
  }

  revokeSudo(agentId: string): boolean {
    const session = this.sessions.get(agentId);

    if (!session) {
      return false;
    }

    this.audit('revoke_sudo', session.privilege, agentId, 'success');

    return this.sessions.delete(agentId);
  }

  hasSudo(agentId: string, required = SudoPrivilege.ELEVATED, operation?: string): boolean {
    const session = this.sessions.get(agentId);

    if (!session) {
      return false;
    }

    if (Date.now() >= session.expiresAt) {
      this.revokeSudo(agentId);
      return false;
    }

    return (
      session.privilege >= required &&
      required <= SudoPrivilege.SYSTEM &&
      (!operation || session.allowedOperations.includes(operation))
    );
  }

  async sudo<T>(agentId: string, operation: string, required: SudoPrivilege, action: () => Promise<T>): Promise<T> {
    if (!this.hasSudo(agentId, required, operation)) {
      this.audit(operation, required, agentId, 'denied', 'Missing, expired or out-of-scope capability');
      throw new Error(`Permission denied: ${operation} requires an explicit scoped capability`);
    }

    try {
      const result = await action();
      this.audit(operation, required, agentId, 'success');

      return result;
    } catch (error) {
      this.audit(operation, required, agentId, 'error', 'Callback failed');
      throw error;
    }
  }

  getAuditLog(agentId?: string): SudoAuditEntry[] {
    return structuredClone(this.auditLog.filter((entry) => !agentId || entry.target === agentId));
  }

  godmode(_agentId: string): never {
    throw new Error('GODMODE is unsupported');
  }

  private audit(
    action: string,
    privilege: SudoPrivilege,
    target: string,
    result: SudoAuditEntry['result'],
    details?: string,
  ) {
    const entry = { timestamp: Date.now(), action, privilege, target, result, details };
    this.auditLog.push(entry);

    if (this.auditLog.length > 1024) {
      this.auditLog.shift();
    }

    const session = this.sessions.get(target);

    if (session) {
      session.auditLog.push(entry);

      if (session.auditLog.length > 128) {
        session.auditLog.shift();
      }
    }
  }
}

interface AgentZeroLike {
  id: string;
  execute?: (task: string, context?: unknown) => Promise<unknown>;
}

/** Does not grant any capability. An authorized caller must grant exact operation scopes first. */
export function withSudo(agent: AgentZeroLike, manager: SudoManager): AgentZeroLike {
  const execute = agent.execute?.bind(agent);

  if (execute) {
    agent.execute = (task, context) =>
      manager.sudo(agent.id, 'execute_task', SudoPrivilege.ELEVATED, () => execute(task, context));
  }

  return agent;
}
export function getSudoSystemPrompt(): string {
  return `Execution security: WebContainer commands run inside the browser, not on the host OS.
Cloudflare Workers cannot launch Linux subprocesses. No ROOT or GODMODE capability is granted.
Only explicitly registered, validated tools can execute. Native commands require a separately authenticated,
non-root Linux runner. Never claim an operation succeeded without an actual executor result.
Destructive and elevated OS operations are disabled in this release. Memory is request-local unless a durable store is configured.`;
}

/** Legacy export; new agents use their own manager to avoid cross-request grants. */
export const sudoManager = new SudoManager();

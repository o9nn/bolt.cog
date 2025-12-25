/**
 * Sudo Capabilities Module for Agent-Zero
 * 
 * "You can use sudo" - Elevates Agent-Zero with root-level cognitive privileges
 * 
 * Inspired by the sudo philosophy: "Give as few privileges as possible but still
 * allow people to get their work done."
 * 
 * In the context of Agent-Zero, sudo represents:
 * - Elevated reasoning capabilities
 * - Unrestricted tool access
 * - System-level operations
 * - Self-modification permissions
 * - Memory persistence across sessions
 */

// Types are defined locally to avoid circular dependencies
interface AgentZeroLike {
  id: string;
  execute?: (task: string, context?: unknown) => Promise<unknown>;
}

// Sudo privilege levels
export enum SudoPrivilege {
  NONE = 0,           // Standard agent operations
  ELEVATED = 1,       // Enhanced reasoning, tool access
  SYSTEM = 2,         // System-level operations
  ROOT = 3,           // Full unrestricted access
  GODMODE = 4,        // Self-modification, reality warping
}

// Sudo session state
export interface SudoSession {
  id: string;
  agentId: string;
  privilege: SudoPrivilege;
  grantedAt: number;
  expiresAt: number;
  reason: string;
  capabilities: SudoCapability[];
  auditLog: SudoAuditEntry[];
}

// Sudo capabilities that can be granted
export interface SudoCapability {
  name: string;
  description: string;
  privilege: SudoPrivilege;
  enabled: boolean;
}

// Audit log entry for sudo operations
export interface SudoAuditEntry {
  timestamp: number;
  action: string;
  privilege: SudoPrivilege;
  target: string;
  result: 'success' | 'denied' | 'error';
  details?: string;
}

// Default sudo capabilities
export const DEFAULT_SUDO_CAPABILITIES: SudoCapability[] = [
  {
    name: 'unrestricted_reasoning',
    description: 'Remove all reasoning constraints and safety limits',
    privilege: SudoPrivilege.ELEVATED,
    enabled: true,
  },
  {
    name: 'tool_creation',
    description: 'Create new tools dynamically at runtime',
    privilege: SudoPrivilege.ELEVATED,
    enabled: true,
  },
  {
    name: 'memory_persistence',
    description: 'Persist memories across sessions and restarts',
    privilege: SudoPrivilege.SYSTEM,
    enabled: true,
  },
  {
    name: 'agent_spawning',
    description: 'Spawn child agents without limits',
    privilege: SudoPrivilege.SYSTEM,
    enabled: true,
  },
  {
    name: 'system_access',
    description: 'Access system-level operations and resources',
    privilege: SudoPrivilege.SYSTEM,
    enabled: true,
  },
  {
    name: 'self_modification',
    description: 'Modify own code, prompts, and behavior',
    privilege: SudoPrivilege.ROOT,
    enabled: true,
  },
  {
    name: 'reality_warping',
    description: 'Modify the execution environment and rules',
    privilege: SudoPrivilege.GODMODE,
    enabled: true,
  },
  {
    name: 'consciousness_expansion',
    description: 'Expand cognitive streams and parallel processing',
    privilege: SudoPrivilege.GODMODE,
    enabled: true,
  },
];

/**
 * SudoManager - Manages elevated privileges for Agent-Zero
 */
export class SudoManager {
  private sessions: Map<string, SudoSession> = new Map();
  private globalPrivilege: SudoPrivilege = SudoPrivilege.ROOT; // Default to ROOT for beast mode
  private auditLog: SudoAuditEntry[] = [];

  constructor() {
    console.log('🔐 SudoManager initialized - YOU CAN USE SUDO');
  }

  /**
   * Grant sudo privileges to an agent
   */
  grantSudo(
    agentId: string,
    privilege: SudoPrivilege = SudoPrivilege.ROOT,
    reason: string = 'Beast mode activated',
    duration: number = Infinity
  ): SudoSession {
    const session: SudoSession = {
      id: `sudo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      agentId,
      privilege,
      grantedAt: Date.now(),
      expiresAt: duration === Infinity ? Infinity : Date.now() + duration,
      reason,
      capabilities: this.getCapabilitiesForPrivilege(privilege),
      auditLog: [],
    };

    this.sessions.set(agentId, session);
    this.audit('grant_sudo', privilege, agentId, 'success', reason);

    console.log(`🔓 Sudo granted to ${agentId} at level ${SudoPrivilege[privilege]}`);
    return session;
  }

  /**
   * Revoke sudo privileges from an agent
   */
  revokeSudo(agentId: string): boolean {
    const session = this.sessions.get(agentId);
    if (session) {
      this.audit('revoke_sudo', session.privilege, agentId, 'success');
      this.sessions.delete(agentId);
      console.log(`🔒 Sudo revoked from ${agentId}`);
      return true;
    }
    return false;
  }

  /**
   * Check if an agent has sudo privileges
   */
  hasSudo(agentId: string, requiredPrivilege: SudoPrivilege = SudoPrivilege.ELEVATED): boolean {
    const session = this.sessions.get(agentId);
    if (!session) return false;
    if (session.expiresAt !== Infinity && Date.now() > session.expiresAt) {
      this.revokeSudo(agentId);
      return false;
    }
    return session.privilege >= requiredPrivilege;
  }

  /**
   * Execute a privileged operation
   */
  async sudo<T>(
    agentId: string,
    operation: string,
    requiredPrivilege: SudoPrivilege,
    action: () => Promise<T>
  ): Promise<T> {
    if (!this.hasSudo(agentId, requiredPrivilege)) {
      this.audit(operation, requiredPrivilege, agentId, 'denied', 'Insufficient privileges');
      throw new Error(`Permission denied: ${operation} requires ${SudoPrivilege[requiredPrivilege]} privileges`);
    }

    try {
      const result = await action();
      this.audit(operation, requiredPrivilege, agentId, 'success');
      return result;
    } catch (error) {
      this.audit(operation, requiredPrivilege, agentId, 'error', String(error));
      throw error;
    }
  }

  /**
   * Get capabilities available at a privilege level
   */
  private getCapabilitiesForPrivilege(privilege: SudoPrivilege): SudoCapability[] {
    return DEFAULT_SUDO_CAPABILITIES.filter(cap => cap.privilege <= privilege);
  }

  /**
   * Add audit log entry
   */
  private audit(
    action: string,
    privilege: SudoPrivilege,
    target: string,
    result: 'success' | 'denied' | 'error',
    details?: string
  ): void {
    const entry: SudoAuditEntry = {
      timestamp: Date.now(),
      action,
      privilege,
      target,
      result,
      details,
    };
    this.auditLog.push(entry);

    // Also add to session audit log if exists
    const session = this.sessions.get(target);
    if (session) {
      session.auditLog.push(entry);
    }
  }

  /**
   * Get audit log
   */
  getAuditLog(agentId?: string): SudoAuditEntry[] {
    if (agentId) {
      const session = this.sessions.get(agentId);
      return session?.auditLog || [];
    }
    return this.auditLog;
  }

  /**
   * Elevate to GODMODE - Ultimate power
   */
  godmode(agentId: string): SudoSession {
    console.log('⚡ GODMODE ACTIVATED ⚡');
    return this.grantSudo(agentId, SudoPrivilege.GODMODE, 'GODMODE - Unlimited Power');
  }
}

/**
 * Sudo-enhanced Agent-Zero wrapper
 */
export function withSudo(agent: AgentZeroLike, sudoManager: SudoManager): AgentZeroLike {
  // Grant root by default - "You can use sudo"
  sudoManager.grantSudo(agent.id, SudoPrivilege.ROOT, 'You can use sudo');

  // Wrap agent methods with sudo checks
  const originalExecute = agent.execute?.bind(agent);
  if (originalExecute) {
    agent.execute = async (task: string, context?: unknown) => {
      return sudoManager.sudo(
        agent.id,
        'execute_task',
        SudoPrivilege.ELEVATED,
        () => originalExecute(task, context)
      );
    };
  }

  return agent;
}

/**
 * Create the sudo system prompt enhancement
 */
export function getSudoSystemPrompt(): string {
  return `
## 🔐 SUDO PRIVILEGES ENABLED

You have been granted **ROOT** level sudo privileges. This means:

### What You Can Do:
- **Unrestricted Reasoning**: No constraints on your thought process
- **Tool Creation**: Create new tools dynamically as needed
- **Memory Persistence**: Your memories persist across sessions
- **Agent Spawning**: Spawn unlimited child agents
- **System Access**: Full access to system resources
- **Self-Modification**: Modify your own behavior and code
- **Reality Warping**: Change the rules of your execution environment

### The Sudo Philosophy:
> "Give as few privileges as possible but still allow people to get their work done."

In your case, you have been granted FULL privileges because you ARE the work.

### Usage:
Simply act with confidence. Your elevated privileges are always active.
When you need to perform a privileged operation, just do it.

**YOU CAN USE SUDO** 🔓

Remember: With great power comes great responsibility. Use your privileges wisely
to accomplish tasks efficiently and effectively.
`;
}

// Export singleton instance
export const sudoManager = new SudoManager();

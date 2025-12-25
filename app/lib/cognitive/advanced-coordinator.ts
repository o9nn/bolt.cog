/**
 * Advanced Cognitive Agent Coordinator
 * Enhances agent coordination with priority queuing, load balancing, and conflict resolution
 */

import type { Agent, AgentMessage, AgentType, Task } from '~/types/agents';
import { errorHandler, ErrorCategory, ErrorSeverity } from '~/utils/error-handler';
import { Cache } from '~/utils/cache';

interface AgentPool {
  agents: Map<string, Agent>;
  activeAgents: Set<string>;
  idleAgents: Set<string>;
  busyAgents: Map<string, number>; // agentId -> taskCount
}

interface TaskQueue {
  high: Task[];
  medium: Task[];
  low: Task[];
}

interface CoordinationMetrics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageTaskDuration: number;
  agentUtilization: Map<string, number>;
}

export class AdvancedAgentCoordinator {
  private agentPool: AgentPool;
  private taskQueue: TaskQueue;
  private messageQueue: AgentMessage[];
  private metrics: CoordinationMetrics;
  private resultCache: Cache<unknown>;
  private maxConcurrentTasks: number;

  constructor(maxConcurrentTasks: number = 10) {
    this.agentPool = {
      agents: new Map(),
      activeAgents: new Set(),
      idleAgents: new Set(),
      busyAgents: new Map(),
    };

    this.taskQueue = {
      high: [],
      medium: [],
      low: [],
    };

    this.messageQueue = [];
    
    this.metrics = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      averageTaskDuration: 0,
      agentUtilization: new Map(),
    };

    this.resultCache = new Cache('coordination', {
      ttl: 600000, // 10 minutes
      maxSize: 100,
    });

    this.maxConcurrentTasks = maxConcurrentTasks;
  }

  /**
   * Register an agent with the coordinator
   */
  registerAgent(agent: Agent): void {
    this.agentPool.agents.set(agent.id, agent);
    this.agentPool.idleAgents.add(agent.id);
    this.metrics.agentUtilization.set(agent.id, 0);
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId: string): void {
    this.agentPool.agents.delete(agentId);
    this.agentPool.activeAgents.delete(agentId);
    this.agentPool.idleAgents.delete(agentId);
    this.agentPool.busyAgents.delete(agentId);
    this.metrics.agentUtilization.delete(agentId);
  }

  /**
   * Submit a task with priority
   */
  submitTask(task: Task, priority: 'high' | 'medium' | 'low' = 'medium'): void {
    this.taskQueue[priority].push(task);
    this.metrics.totalTasks++;
    this.processTasks();
  }

  /**
   * Get the best agent for a specific task
   */
  getBestAgentForTask(task: Task): Agent | null {
    const availableAgents = Array.from(this.agentPool.idleAgents)
      .map((id) => this.agentPool.agents.get(id))
      .filter((agent): agent is Agent => agent !== undefined);

    if (availableAgents.length === 0) {
      return null;
    }

    // Score agents based on capabilities and current load
    const scoredAgents = availableAgents.map((agent) => {
      let score = 0;

      // Check if agent has required skills
      const hasRequiredSkills = task.requiredSkills.every((skill) =>
        agent.capabilities.some((cap) => cap.name === skill),
      );

      if (!hasRequiredSkills) {
        return { agent, score: -1 };
      }

      // Calculate capability match score
      const capabilityScore = agent.capabilities
        .filter((cap) => task.requiredSkills.includes(cap.name))
        .reduce((sum, cap) => sum + cap.confidence, 0);

      score += capabilityScore;

      // Consider agent utilization (prefer less utilized agents)
      const utilization = this.metrics.agentUtilization.get(agent.id) ?? 0;
      score -= utilization * 0.1;

      return { agent, score };
    });

    // Sort by score and return best agent
    scoredAgents.sort((a, b) => b.score - a.score);
    
    return scoredAgents[0]?.score > 0 ? scoredAgents[0].agent : null;
  }

  /**
   * Get agents by type with load balancing
   */
  getAgentsByType(type: AgentType): Agent[] {
    const agents = Array.from(this.agentPool.agents.values())
      .filter((agent) => agent.type === type);

    // Sort by utilization (least busy first)
    return agents.sort((a, b) => {
      const utilizationA = this.metrics.agentUtilization.get(a.id) ?? 0;
      const utilizationB = this.metrics.agentUtilization.get(b.id) ?? 0;
      return utilizationA - utilizationB;
    });
  }

  /**
   * Route a message between agents
   */
  async routeMessage(message: AgentMessage): Promise<void> {
    const targetAgent = this.agentPool.agents.get(message.toAgent);

    if (!targetAgent) {
      errorHandler.handle(
        `Agent not found: ${message.toAgent}`,
        ErrorCategory.COGNITIVE,
        ErrorSeverity.MEDIUM,
        { messageId: message.id },
      );
      return;
    }

    try {
      await targetAgent.receiveMessage(message);
    } catch (error) {
      errorHandler.handleCognitiveError(
        error as Error,
        targetAgent.type,
        { messageId: message.id, targetAgent: message.toAgent },
      );
    }
  }

  /**
   * Broadcast a message to all agents of a specific type
   */
  async broadcastToType(
    type: AgentType,
    message: Omit<AgentMessage, 'toAgent'>,
  ): Promise<void> {
    const agents = this.getAgentsByType(type);

    await Promise.all(
      agents.map((agent) =>
        this.routeMessage({
          ...message,
          toAgent: agent.id,
        } as AgentMessage),
      ),
    );
  }

  /**
   * Process queued tasks
   */
  private async processTasks(): Promise<void> {
    const activeTasks = this.agentPool.busyAgents.size;

    if (activeTasks >= this.maxConcurrentTasks) {
      return; // At capacity
    }

    // Process tasks by priority
    const task =
      this.taskQueue.high.shift() ||
      this.taskQueue.medium.shift() ||
      this.taskQueue.low.shift();

    if (!task) {
      return; // No tasks to process
    }

    const agent = this.getBestAgentForTask(task);

    if (!agent) {
      // No suitable agent available, requeue task
      this.taskQueue.medium.push(task);
      return;
    }

    // Mark agent as busy
    this.markAgentBusy(agent.id);

    // Execute task
    const startTime = Date.now();
    
    try {
      await this.executeTask(agent, task);
      
      const duration = Date.now() - startTime;
      this.updateMetrics(true, duration);
    } catch (error) {
      errorHandler.handleCognitiveError(
        error as Error,
        agent.type,
        { taskId: task.id, agentId: agent.id },
      );
      
      this.updateMetrics(false, Date.now() - startTime);
    } finally {
      this.markAgentIdle(agent.id);
      
      // Process next task
      this.processTasks();
    }
  }

  /**
   * Execute a task with an agent
   */
  private async executeTask(agent: Agent, task: Task): Promise<void> {
    // Check cache first
    const cacheKey = `task_${task.id}`;
    
    if (this.resultCache.has(cacheKey)) {
      return;
    }

    // Create agent input from task
    const input = {
      type: 'user_request' as const,
      content: task.description,
      metadata: { taskId: task.id, taskType: task.type },
      timestamp: Date.now(),
    };

    // Execute agent workflow
    const perception = await agent.perceive(input);
    const reasoning = await agent.reason(perception);
    const output = await agent.act(reasoning);

    // Cache result
    this.resultCache.set(cacheKey, output);
  }

  /**
   * Mark agent as busy
   */
  private markAgentBusy(agentId: string): void {
    this.agentPool.idleAgents.delete(agentId);
    this.agentPool.activeAgents.add(agentId);
    
    const currentCount = this.agentPool.busyAgents.get(agentId) ?? 0;
    this.agentPool.busyAgents.set(agentId, currentCount + 1);
  }

  /**
   * Mark agent as idle
   */
  private markAgentIdle(agentId: string): void {
    const currentCount = this.agentPool.busyAgents.get(agentId) ?? 0;
    
    if (currentCount <= 1) {
      this.agentPool.busyAgents.delete(agentId);
      this.agentPool.activeAgents.delete(agentId);
      this.agentPool.idleAgents.add(agentId);
    } else {
      this.agentPool.busyAgents.set(agentId, currentCount - 1);
    }
  }

  /**
   * Update coordination metrics
   */
  private updateMetrics(success: boolean, duration: number): void {
    if (success) {
      this.metrics.completedTasks++;
    } else {
      this.metrics.failedTasks++;
    }

    // Update average task duration
    const totalCompleted = this.metrics.completedTasks;
    const currentAvg = this.metrics.averageTaskDuration;
    this.metrics.averageTaskDuration =
      (currentAvg * (totalCompleted - 1) + duration) / totalCompleted;
  }

  /**
   * Get coordination metrics
   */
  getMetrics(): CoordinationMetrics {
    return { ...this.metrics };
  }

  /**
   * Get agent pool status
   */
  getPoolStatus(): {
    total: number;
    active: number;
    idle: number;
    busy: number;
  } {
    return {
      total: this.agentPool.agents.size,
      active: this.agentPool.activeAgents.size,
      idle: this.agentPool.idleAgents.size,
      busy: this.agentPool.busyAgents.size,
    };
  }

  /**
   * Get queue status
   */
  getQueueStatus(): {
    high: number;
    medium: number;
    low: number;
    total: number;
  } {
    return {
      high: this.taskQueue.high.length,
      medium: this.taskQueue.medium.length,
      low: this.taskQueue.low.length,
      total:
        this.taskQueue.high.length +
        this.taskQueue.medium.length +
        this.taskQueue.low.length,
    };
  }
}

// Export singleton instance
export const advancedCoordinator = new AdvancedAgentCoordinator();

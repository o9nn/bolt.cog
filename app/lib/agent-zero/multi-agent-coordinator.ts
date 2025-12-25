/**
 * Agent-Zero Multi-Agent Coordinator
 * Manages hierarchical agent cooperation and task delegation
 */

import { AgentZero } from './agent';
import type {
  AgentZeroConfig,
  AgentTask,
  AgentMessage,
  TaskResult,
  AgentState,
} from './types';

export class MultiAgentCoordinator {
  private agents: Map<string, AgentZero>;
  private hierarchy: Map<string, string[]>; // parent -> children
  private taskQueue: PriorityQueue<QueuedTask>;
  private messageQueue: AgentMessage[];
  private metrics: CoordinatorMetrics;

  constructor() {
    this.agents = new Map();
    this.hierarchy = new Map();
    this.taskQueue = new PriorityQueue();
    this.messageQueue = [];
    this.metrics = {
      totalAgents: 0,
      activeAgents: 0,
      tasksProcessed: 0,
      tasksFailed: 0,
      messagesRouted: 0,
      averageTaskDuration: 0,
    };
  }

  /**
   * Create and register a new agent
   */
  createAgent(config: AgentZeroConfig): AgentZero {
    const agent = new AgentZero(config);
    this.agents.set(config.id, agent);
    this.metrics.totalAgents++;

    // Update hierarchy
    if (config.superiorId) {
      const children = this.hierarchy.get(config.superiorId) || [];
      children.push(config.id);
      this.hierarchy.set(config.superiorId, children);
    }

    // Subscribe to agent events
    this.subscribeToAgentEvents(agent);

    return agent;
  }

  /**
   * Get an agent by ID
   */
  getAgent(id: string): AgentZero | undefined {
    return this.agents.get(id);
  }

  /**
   * Get all agents
   */
  getAllAgents(): AgentZero[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agent hierarchy
   */
  getHierarchy(): AgentHierarchy {
    const root = this.findRootAgents();
    return this.buildHierarchyTree(root);
  }

  /**
   * Submit a task to the coordinator
   */
  async submitTask(task: AgentTask): Promise<TaskResult> {
    // Find best agent for the task
    const assignee = await this.findBestAgent(task);
    
    if (!assignee) {
      return {
        success: false,
        output: 'No suitable agent found',
        artifacts: [],
        learnings: [],
        duration: 0,
      };
    }

    // Queue the task
    this.taskQueue.enqueue({
      task: { ...task, assignedTo: assignee },
      priority: task.priority,
      timestamp: Date.now(),
    });

    // Process the task
    return this.processTask(task, assignee);
  }

  /**
   * Route a message between agents
   */
  async routeMessage(message: AgentMessage): Promise<void> {
    const recipient = this.agents.get(message.to);
    
    if (!recipient) {
      console.error(`Agent not found: ${message.to}`);
      return;
    }

    await recipient.receiveMessage(message);
    this.metrics.messagesRouted++;
  }

  /**
   * Broadcast a message to all agents
   */
  async broadcast(
    from: string,
    content: string,
    type: AgentMessage['type'] = 'instruction',
  ): Promise<void> {
    const message: Omit<AgentMessage, 'to'> = {
      id: this.generateId(),
      from,
      type,
      content,
      priority: 'medium',
      timestamp: Date.now(),
      requiresResponse: false,
    };

    for (const [id] of this.agents) {
      if (id !== from) {
        await this.routeMessage({ ...message, to: id });
      }
    }
  }

  /**
   * Get coordinator metrics
   */
  getMetrics(): CoordinatorMetrics {
    // Update active agents count
    this.metrics.activeAgents = Array.from(this.agents.values()).filter(
      (agent) => agent.getState().status !== 'idle'
    ).length;

    return { ...this.metrics };
  }

  /**
   * Get agent load balancing info
   */
  getLoadBalancing(): LoadBalancingInfo[] {
    return Array.from(this.agents.values()).map((agent) => {
      const state = agent.getState();
      return {
        agentId: agent.getConfig().id,
        status: state.status,
        currentTaskCount: state.currentTask ? 1 : 0,
        subordinateCount: state.subordinates.length,
        metrics: state.metrics,
      };
    });
  }

  /**
   * Rebalance tasks across agents
   */
  async rebalance(): Promise<void> {
    const loadInfo = this.getLoadBalancing();
    
    // Find overloaded and underloaded agents
    const avgLoad = loadInfo.reduce((acc, info) => 
      acc + info.currentTaskCount, 0) / loadInfo.length;

    const overloaded = loadInfo.filter((info) => info.currentTaskCount > avgLoad * 1.5);
    const underloaded = loadInfo.filter((info) => info.currentTaskCount < avgLoad * 0.5);

    // Redistribute tasks (simplified - would need actual task migration)
    for (const over of overloaded) {
      const agent = this.agents.get(over.agentId);
      if (agent && underloaded.length > 0) {
        // Signal agent to delegate
        await this.routeMessage({
          id: this.generateId(),
          from: 'coordinator',
          to: over.agentId,
          type: 'instruction',
          content: 'Consider delegating tasks to subordinates',
          priority: 'medium',
          timestamp: Date.now(),
          requiresResponse: false,
        });
      }
    }
  }

  /**
   * Shutdown all agents gracefully
   */
  async shutdown(): Promise<void> {
    // Broadcast shutdown signal
    await this.broadcast('coordinator', 'Shutdown initiated', 'instruction');

    // Wait for active tasks to complete (with timeout)
    const timeout = 30000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const activeCount = Array.from(this.agents.values()).filter(
        (agent) => agent.getState().status !== 'idle'
      ).length;

      if (activeCount === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.agents.clear();
    this.hierarchy.clear();
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private subscribeToAgentEvents(agent: AgentZero): void {
    agent.on('task_completed', async (event) => {
      if (event.type === 'task_completed') {
        this.metrics.tasksProcessed++;
        this.updateAverageTaskDuration(event.result.duration);
      }
    });

    agent.on('task_failed', async (event) => {
      if (event.type === 'task_failed') {
        this.metrics.tasksFailed++;
      }
    });

    agent.on('subordinate_created', async (event) => {
      if (event.type === 'subordinate_created') {
        // Track new subordinate in hierarchy
        const parentId = agent.getConfig().id;
        const children = this.hierarchy.get(parentId) || [];
        if (!children.includes(event.subordinateId)) {
          children.push(event.subordinateId);
          this.hierarchy.set(parentId, children);
        }
      }
    });
  }

  private async findBestAgent(task: AgentTask): Promise<string | null> {
    const candidates: { id: string; score: number }[] = [];

    for (const [id, agent] of this.agents) {
      const state = agent.getState();
      const config = agent.getConfig();

      // Skip busy agents
      if (state.status !== 'idle' && state.status !== 'thinking') {
        continue;
      }

      // Calculate suitability score
      let score = 0;

      // Prefer agents with relevant capabilities
      const taskKeywords = task.description.toLowerCase().split(/\s+/);
      for (const cap of config.capabilities) {
        if (cap.enabled && taskKeywords.some((k) => cap.name.toLowerCase().includes(k))) {
          score += cap.confidence * 10;
        }
      }

      // Prefer agents with lower load
      score += (10 - state.subordinates.length);

      // Prefer agents with better success rate
      const successRate = state.metrics.tasksCompleted / 
        (state.metrics.tasksCompleted + state.metrics.tasksFailed + 1);
      score += successRate * 5;

      candidates.push({ id, score });
    }

    if (candidates.length === 0) return null;

    // Return highest scoring agent
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].id;
  }

  private async processTask(task: AgentTask, assigneeId: string): Promise<TaskResult> {
    const agent = this.agents.get(assigneeId);
    
    if (!agent) {
      return {
        success: false,
        output: `Agent not found: ${assigneeId}`,
        artifacts: [],
        learnings: [],
        duration: 0,
      };
    }

    const startTime = Date.now();

    try {
      const output = await agent.run(task.description);
      
      return {
        success: true,
        output,
        artifacts: [],
        learnings: [],
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : String(error),
        artifacts: [],
        learnings: [],
        duration: Date.now() - startTime,
      };
    }
  }

  private findRootAgents(): string[] {
    const allChildren = new Set<string>();
    
    for (const children of this.hierarchy.values()) {
      children.forEach((c) => allChildren.add(c));
    }

    return Array.from(this.agents.keys()).filter((id) => !allChildren.has(id));
  }

  private buildHierarchyTree(rootIds: string[]): AgentHierarchy {
    const buildNode = (id: string): AgentHierarchyNode => {
      const agent = this.agents.get(id);
      const children = this.hierarchy.get(id) || [];

      return {
        id,
        name: agent?.getConfig().name || id,
        role: agent?.getConfig().role || 'subordinate',
        status: agent?.getState().status || 'idle',
        children: children.map(buildNode),
      };
    };

    return {
      roots: rootIds.map(buildNode),
      totalAgents: this.agents.size,
      depth: this.calculateMaxDepth(rootIds),
    };
  }

  private calculateMaxDepth(rootIds: string[]): number {
    const getDepth = (id: string): number => {
      const children = this.hierarchy.get(id) || [];
      if (children.length === 0) return 1;
      return 1 + Math.max(...children.map(getDepth));
    };

    return rootIds.length === 0 ? 0 : Math.max(...rootIds.map(getDepth));
  }

  private updateAverageTaskDuration(duration: number): void {
    const total = this.metrics.tasksProcessed;
    this.metrics.averageTaskDuration = 
      (this.metrics.averageTaskDuration * (total - 1) + duration) / total;
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Priority Queue Implementation
class PriorityQueue<T extends { priority: number }> {
  private items: T[] = [];

  enqueue(item: T): void {
    let added = false;
    for (let i = 0; i < this.items.length; i++) {
      if (item.priority > this.items[i].priority) {
        this.items.splice(i, 0, item);
        added = true;
        break;
      }
    }
    if (!added) {
      this.items.push(item);
    }
  }

  dequeue(): T | undefined {
    return this.items.shift();
  }

  peek(): T | undefined {
    return this.items[0];
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  size(): number {
    return this.items.length;
  }
}

// Types
interface QueuedTask {
  task: AgentTask;
  priority: number;
  timestamp: number;
}

interface CoordinatorMetrics {
  totalAgents: number;
  activeAgents: number;
  tasksProcessed: number;
  tasksFailed: number;
  messagesRouted: number;
  averageTaskDuration: number;
}

interface LoadBalancingInfo {
  agentId: string;
  status: AgentState['status'];
  currentTaskCount: number;
  subordinateCount: number;
  metrics: AgentState['metrics'];
}

interface AgentHierarchy {
  roots: AgentHierarchyNode[];
  totalAgents: number;
  depth: number;
}

interface AgentHierarchyNode {
  id: string;
  name: string;
  role: 'superior' | 'subordinate' | 'peer';
  status: AgentState['status'];
  children: AgentHierarchyNode[];
}

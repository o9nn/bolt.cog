/**
 * Agent network coordinator - manages distributed agent communication
 * Implements the distributed network aspect of agentic cognitive grammar.
 */

import type { Agent, AgentType, AgentInput, AgentMessage, AgentOutput, Experience, Knowledge } from '~/types/agents';

export interface NetworkMetrics {
  totalAgents: number;
  activeAgents: number;
  messageQueue: number;
  averageResponseTime: number;
  collaborationScore: number;
}

export interface NetworkEvent {
  type: 'agent_joined' | 'agent_left' | 'message_sent' | 'task_completed' | 'error_occurred';
  timestamp: number;
  agentId?: string;
  data: Record<string, unknown>;
}

export class AgentNetworkCoordinator {
  private agents: Map<string, Agent> = new Map();
  private messageQueue: AgentMessage[] = [];
  private eventHistory: NetworkEvent[] = [];
  private knowledge: Knowledge[] = [];
  private isProcessing = false;

  registerAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
    this.logEvent({
      type: 'agent_joined',
      timestamp: Date.now(),
      agentId: agent.id,
      data: { agentType: agent.type, capabilities: agent.capabilities.length },
    });
  }

  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId);

    if (agent) {
      this.agents.delete(agentId);
      this.logEvent({
        type: 'agent_left',
        timestamp: Date.now(),
        agentId,
        data: { agentType: agent.type },
      });
    }
  }

  async processInput(input: AgentInput): Promise<AgentOutput[]> {
    const relevantAgents = this.findRelevantAgents(input);
    const outputs: AgentOutput[] = [];

    // process input through cognitive grammar enhancement first
    const enhancedInput = await this.enhanceInput(input);

    // coordinate agent responses
    for (const agent of relevantAgents) {
      try {
        const perception = await agent.perceive(enhancedInput);

        if (perception.understood) {
          const reasoning = await agent.reason(perception);
          const output = await agent.act(reasoning);
          outputs.push(output);

          // process any collaboration requests
          if (output.type === 'collaboration_request') {
            await this.handleCollaborationRequest(agent.id, output);
          }

          // queue messages for other agents
          for (const message of output.messages) {
            this.queueMessage(message);
          }
        }
      } catch (error) {
        console.error(`Error processing input with agent ${agent.id}:`, error);
        this.logEvent({
          type: 'error_occurred',
          timestamp: Date.now(),
          agentId: agent.id,
          data: { error: error instanceof Error ? error.message : 'Unknown error' },
        });
      }
    }

    // process queued messages
    await this.processMessageQueue();

    return outputs;
  }

  async broadcastMessage(message: Omit<AgentMessage, 'id' | 'timestamp'>): Promise<void> {
    const fullMessage: AgentMessage = {
      ...message,
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };

    this.queueMessage(fullMessage);
    await this.processMessageQueue();
  }

  getNetworkMetrics(): NetworkMetrics {
    const activeAgents = Array.from(this.agents.values()).filter(
      (agent) => agent.status !== 'idle' && agent.status !== 'error',
    );

    const recentEvents = this.eventHistory.filter(
      (event) => Date.now() - event.timestamp < 60000, // last minute
    );

    const responseTimeSum = recentEvents.reduce((sum, event) => {
      return sum + ((event.data.responseTime as number) || 0);
    }, 0);

    return {
      totalAgents: this.agents.size,
      activeAgents: activeAgents.length,
      messageQueue: this.messageQueue.length,
      averageResponseTime: responseTimeSum / Math.max(recentEvents.length, 1),
      collaborationScore: this.calculateCollaborationScore(),
    };
  }

  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  getAgentsByType(type: AgentType): Agent[] {
    return Array.from(this.agents.values()).filter((agent) => agent.type === type);
  }

  shareKnowledge(knowledge: Knowledge): void {
    this.knowledge.push(knowledge);

    // broadcast knowledge to all agents
    const message: Omit<AgentMessage, 'id' | 'timestamp'> = {
      fromAgent: 'network_coordinator',
      toAgent: 'all',
      type: 'knowledge_share',
      content: `New knowledge shared: ${knowledge.content}`,
      metadata: { knowledge },
      urgency: 'low',
    };

    this.broadcastMessage(message);
  }

  recordExperience(agentId: string, experience: Experience): void {
    const agent = this.agents.get(agentId);

    if (agent) {
      agent.updateKnowledge(experience);

      // convert valuable experiences to knowledge for network sharing
      if (experience.success && experience.lessons.length > 0) {
        const knowledge: Knowledge = {
          type: 'heuristic',
          content: experience.lessons.join(', '),
          confidence: experience.success ? 0.8 : 0.4,
          context: [experience.situation],
          source: agentId,
        };

        this.shareKnowledge(knowledge);
      }
    }
  }

  private findRelevantAgents(input: AgentInput): Agent[] {
    const allAgents = Array.from(this.agents.values());

    // score agents based on input relevance
    const scoredAgents = allAgents.map((agent) => ({
      agent,
      score: this.calculateRelevanceScore(agent, input),
    }));

    // return agents with score above threshold, sorted by score
    return scoredAgents
      .filter(({ score }) => score > 0.1) // lower threshold to ensure agents are selected
      .sort((a, b) => b.score - a.score)
      .map(({ agent }) => agent);
  }

  private calculateRelevanceScore(agent: Agent, input: AgentInput): number {
    let score = 0;

    // base score based on agent type and input type
    if (input.type === 'user_request') {
      if (agent.type === 'grammar' || agent.type === 'planning') {
        score += 0.5;
      }
    } else if (input.type === 'code_change') {
      if (agent.type === 'grammar' || agent.type === 'context') {
        score += 0.5;
      }
    }

    // score based on capabilities
    for (const capability of agent.capabilities) {
      if (input.content.toLowerCase().includes(capability.name.toLowerCase())) {
        score += capability.confidence * 0.3;
      }
    }

    // score based on agent status (prefer non-busy agents)
    if (agent.status === 'idle') {
      score += 0.2;
    } else if (agent.status === 'thinking') {
      score -= 0.1;
    }

    return Math.min(score, 1.0);
  }

  private async enhanceInput(input: AgentInput): Promise<AgentInput> {
    // find grammar agents to enhance the input
    const grammarAgents = this.getAgentsByType('grammar');

    if (grammarAgents.length > 0) {
      try {
        const grammarAgent = grammarAgents[0];
        const perception = await grammarAgent.perceive(input);

        if (perception.understood && perception.suggestedActions.length > 0) {
          return {
            ...input,
            content: perception.suggestedActions[0], // use enhanced suggestion
            metadata: {
              ...input.metadata,
              originalContent: input.content,
              enhancedBy: grammarAgent.id,
              confidence: perception.confidence,
            },
          };
        }
      } catch (error) {
        console.warn('Failed to enhance input with grammar agent:', error);
      }
    }

    return input;
  }

  private async handleCollaborationRequest(requestingAgentId: string, output: AgentOutput): Promise<void> {
    // find agents that can help with the collaboration
    const availableAgents = Array.from(this.agents.values()).filter(
      (agent) => agent.id !== requestingAgentId && agent.status === 'idle',
    );

    // send collaboration messages
    for (const message of output.messages) {
      if (message.toAgent !== 'all') {
        const targetAgent = this.agents.get(message.toAgent);

        if (targetAgent) {
          await targetAgent.receiveMessage(message);
        }
      } else {
        // broadcast to all available agents
        for (const agent of availableAgents) {
          await agent.receiveMessage({
            ...message,
            toAgent: agent.id,
          });
        }
      }
    }
  }

  private queueMessage(message: AgentMessage): void {
    this.messageQueue.push(message);
    this.logEvent({
      type: 'message_sent',
      timestamp: Date.now(),
      agentId: message.fromAgent,
      data: {
        messageType: message.type,
        urgency: message.urgency,
        toAgent: message.toAgent,
      },
    });
  }

  private async processMessageQueue(): Promise<void> {
    if (this.isProcessing || this.messageQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      // process messages by urgency
      const sortedMessages = this.messageQueue.sort((a, b) => {
        const urgencyOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        return urgencyOrder[b.urgency] - urgencyOrder[a.urgency];
      });

      this.messageQueue = [];

      for (const message of sortedMessages) {
        if (message.toAgent === 'all') {
          // broadcast to all agents
          for (const agent of this.agents.values()) {
            if (agent.id !== message.fromAgent) {
              await agent.receiveMessage({
                ...message,
                toAgent: agent.id,
              });
            }
          }
        } else {
          // send to specific agent
          const targetAgent = this.agents.get(message.toAgent);

          if (targetAgent) {
            await targetAgent.receiveMessage(message);
          }
        }
      }
    } catch (error) {
      console.error('Error processing message queue:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private calculateCollaborationScore(): number {
    const recentEvents = this.eventHistory.filter(
      (event) => Date.now() - event.timestamp < 300000, // last 5 minutes
    );

    const collaborationEvents = recentEvents.filter((event) => event.type === 'message_sent');

    const totalAgents = this.agents.size;

    if (totalAgents < 2) {
      return 0;
    }

    // score based on message exchange frequency
    const messagesPerAgent = collaborationEvents.length / totalAgents;

    return Math.min(messagesPerAgent / 10, 1.0); // normalize to 0-1
  }

  private logEvent(event: NetworkEvent): void {
    this.eventHistory.push(event);

    // keep only recent events to prevent memory bloat
    const cutoff = Date.now() - 3600000; // 1 hour
    this.eventHistory = this.eventHistory.filter((e) => e.timestamp > cutoff);
  }
}

export const agentNetworkCoordinator = new AgentNetworkCoordinator();

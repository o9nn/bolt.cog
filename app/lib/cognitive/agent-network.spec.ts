/**
 * Tests for the agent network coordinator
 * Validates distributed agent communication and coordination.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentNetworkCoordinator } from '~/lib/cognitive/agent-network';
import { GrammarAgent, ContextAgent, PlanningAgent, ExecutionAgent } from '~/lib/cognitive/specialized-agents';
import type { AgentInput } from '~/types/agents';

describe('AgentNetworkCoordinator', () => {
  let coordinator: AgentNetworkCoordinator;
  let grammarAgent: GrammarAgent;
  let contextAgent: ContextAgent;
  let planningAgent: PlanningAgent;
  let executionAgent: ExecutionAgent;

  beforeEach(() => {
    coordinator = new AgentNetworkCoordinator();
    grammarAgent = new GrammarAgent('grammar_test', 'Test Grammar Agent');
    contextAgent = new ContextAgent('context_test', 'Test Context Agent');
    planningAgent = new PlanningAgent('planning_test', 'Test Planning Agent');
    executionAgent = new ExecutionAgent('execution_test', 'Test Execution Agent');
  });

  describe('agent registration', () => {
    it('should register agents successfully', () => {
      coordinator.registerAgent(grammarAgent);
      coordinator.registerAgent(contextAgent);

      const metrics = coordinator.getNetworkMetrics();
      expect(metrics.totalAgents).toBe(2);
    });

    it('should unregister agents successfully', () => {
      coordinator.registerAgent(grammarAgent);
      coordinator.registerAgent(contextAgent);
      coordinator.unregisterAgent(grammarAgent.id);

      const metrics = coordinator.getNetworkMetrics();
      expect(metrics.totalAgents).toBe(1);
    });

    it('should get agents by type', () => {
      coordinator.registerAgent(grammarAgent);
      coordinator.registerAgent(contextAgent);
      coordinator.registerAgent(planningAgent);

      const grammarAgents = coordinator.getAgentsByType('grammar');
      const contextAgents = coordinator.getAgentsByType('context');

      expect(grammarAgents).toHaveLength(1);
      expect(contextAgents).toHaveLength(1);
      expect(grammarAgents[0].id).toBe(grammarAgent.id);
    });
  });

  describe('input processing', () => {
    beforeEach(() => {
      coordinator.registerAgent(grammarAgent);
      coordinator.registerAgent(contextAgent);
      coordinator.registerAgent(planningAgent);
      coordinator.registerAgent(executionAgent);
    });

    it('should process user requests through relevant agents', async () => {
      const input: AgentInput = {
        type: 'user_request',
        content: 'create a new React component',
        metadata: {},
        timestamp: Date.now(),
      };

      const outputs = await coordinator.processInput(input);

      expect(outputs.length).toBeGreaterThan(0);
      expect(outputs.some((output) => output.type === 'response')).toBe(true);
    });

    it('should handle code change inputs', async () => {
      const input: AgentInput = {
        type: 'code_change',
        content: 'function newFunction() { return "test"; }',
        metadata: { file: 'test.ts' },
        timestamp: Date.now(),
      };

      const outputs = await coordinator.processInput(input);

      expect(outputs.length).toBeGreaterThan(0);
    });

    it('should enhance input through grammar agents', async () => {
      const input: AgentInput = {
        type: 'user_request',
        content: 'create component',
        metadata: {},
        timestamp: Date.now(),
      };

      // mock the grammar agent's perceive method to return enhanced content
      vi.spyOn(grammarAgent, 'perceive').mockResolvedValue({
        understood: true,
        confidence: 0.8,
        semanticNodes: [],
        missingInfo: [],
        suggestedActions: ['Create a component with proper TypeScript types and React best practices'],
      });

      const outputs = await coordinator.processInput(input);

      expect(grammarAgent.perceive).toHaveBeenCalled();
      expect(outputs.length).toBeGreaterThan(0);
    });
  });

  describe('message broadcasting', () => {
    beforeEach(() => {
      coordinator.registerAgent(grammarAgent);
      coordinator.registerAgent(contextAgent);
    });

    it('should broadcast messages to all agents', async () => {
      const message = {
        fromAgent: 'system',
        toAgent: 'all',
        type: 'notification' as const,
        content: 'System update available',
        metadata: {},
        urgency: 'low' as const,
      };

      const receiveMessageSpy1 = vi.spyOn(grammarAgent, 'receiveMessage').mockResolvedValue();
      const receiveMessageSpy2 = vi.spyOn(contextAgent, 'receiveMessage').mockResolvedValue();

      await coordinator.broadcastMessage(message);

      expect(receiveMessageSpy1).toHaveBeenCalled();
      expect(receiveMessageSpy2).toHaveBeenCalled();
    });
  });

  describe('knowledge sharing', () => {
    beforeEach(() => {
      coordinator.registerAgent(grammarAgent);
      coordinator.registerAgent(contextAgent);
    });

    it('should share knowledge across the network', async () => {
      const knowledge = {
        type: 'pattern' as const,
        content: 'React components should use TypeScript interfaces for props',
        confidence: 0.9,
        context: ['react', 'typescript'],
        source: 'best_practices',
      };

      const receiveMessageSpy1 = vi.spyOn(grammarAgent, 'receiveMessage').mockResolvedValue();
      const receiveMessageSpy2 = vi.spyOn(contextAgent, 'receiveMessage').mockResolvedValue();

      coordinator.shareKnowledge(knowledge);

      // knowledge sharing should trigger message broadcasting
      await new Promise((resolve) => setTimeout(resolve, 10)); // allow async operations

      expect(receiveMessageSpy1).toHaveBeenCalled();
      expect(receiveMessageSpy2).toHaveBeenCalled();
    });

    it('should record successful experiences as knowledge', () => {
      const experience = {
        situation: 'Creating React component',
        action: 'Used TypeScript interface',
        outcome: 'Component created successfully',
        feedback: 'Type safety improved',
        success: true,
        lessons: ['Always use TypeScript interfaces for React props'],
      };

      const shareKnowledgeSpy = vi.spyOn(coordinator, 'shareKnowledge');

      coordinator.recordExperience(grammarAgent.id, experience);

      expect(shareKnowledgeSpy).toHaveBeenCalledWith({
        type: 'heuristic',
        content: experience.lessons.join(', '),
        confidence: 0.8,
        context: [experience.situation],
        source: grammarAgent.id,
      });
    });
  });

  describe('network metrics', () => {
    it('should calculate collaboration score based on message activity', async () => {
      coordinator.registerAgent(grammarAgent);
      coordinator.registerAgent(contextAgent);

      // simulate message exchange
      await coordinator.broadcastMessage({
        fromAgent: grammarAgent.id,
        toAgent: 'all',
        type: 'request',
        content: 'Need context information',
        metadata: {},
        urgency: 'medium',
      });

      const metrics = coordinator.getNetworkMetrics();

      expect(metrics.totalAgents).toBe(2);
      expect(metrics.collaborationScore).toBeGreaterThanOrEqual(0);
    });

    it('should track active agents correctly', () => {
      coordinator.registerAgent(grammarAgent);
      coordinator.registerAgent(contextAgent);

      // set agents to different states
      grammarAgent.status = 'thinking';
      contextAgent.status = 'idle';

      const metrics = coordinator.getNetworkMetrics();

      expect(metrics.totalAgents).toBe(2);
      expect(metrics.activeAgents).toBe(1); // only thinking agent is considered active
    });
  });

  describe('error handling', () => {
    it('should handle agent errors gracefully', async () => {
      coordinator.registerAgent(grammarAgent);

      // mock an agent that throws an error
      vi.spyOn(grammarAgent, 'perceive').mockRejectedValue(new Error('Agent error'));

      const input: AgentInput = {
        type: 'user_request',
        content: 'test input',
        metadata: {},
        timestamp: Date.now(),
      };

      const outputs = await coordinator.processInput(input);

      // should not throw, but should handle the error gracefully
      expect(outputs).toBeDefined();
    });

    it('should continue processing other agents when one fails', async () => {
      coordinator.registerAgent(grammarAgent);
      coordinator.registerAgent(contextAgent);

      // mock one agent to fail and another to succeed
      vi.spyOn(grammarAgent, 'perceive').mockRejectedValue(new Error('Grammar agent error'));
      vi.spyOn(contextAgent, 'perceive').mockResolvedValue({
        understood: true,
        confidence: 0.7,
        semanticNodes: [],
        missingInfo: [],
        suggestedActions: ['Context analysis completed'],
      });

      const input: AgentInput = {
        type: 'user_request',
        content: 'test input',
        metadata: {},
        timestamp: Date.now(),
      };

      const outputs = await coordinator.processInput(input);

      expect(contextAgent.perceive).toHaveBeenCalled();
      expect(outputs.length).toBeGreaterThan(0);
    });
  });
});

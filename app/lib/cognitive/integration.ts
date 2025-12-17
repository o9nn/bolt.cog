/**
 * Cognitive agent integration layer
 * Bridges the distributed agent network with existing Bolt.new architecture
 */

import type { Messages } from '~/lib/.server/llm/stream-text';
import type { AgentInput, AgentOutput } from '~/types/agents';
import { agentNetworkCoordinator } from './agent-network';
import { GrammarAgent, ContextAgent, PlanningAgent, ExecutionAgent } from './specialized-agents';

class CognitiveAgentIntegration {
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Create and register specialized agents
    const grammarAgent = new GrammarAgent('grammar_001', 'Primary Grammar Agent');
    const contextAgent = new ContextAgent('context_001', 'Primary Context Agent');
    const planningAgent = new PlanningAgent('planning_001', 'Primary Planning Agent');
    const executionAgent = new ExecutionAgent('execution_001', 'Primary Execution Agent');

    // Register agents with the network coordinator
    agentNetworkCoordinator.registerAgent(grammarAgent);
    agentNetworkCoordinator.registerAgent(contextAgent);
    agentNetworkCoordinator.registerAgent(planningAgent);
    agentNetworkCoordinator.registerAgent(executionAgent);

    this.isInitialized = true;
    
    console.log('Cognitive agent network initialized with distributed agentic cognitive grammar');
  }

  async enhanceMessages(messages: Messages): Promise<Messages> {
    await this.initialize();

    // Get the latest user message
    const latestMessage = messages[messages.length - 1];
    if (!latestMessage || latestMessage.role !== 'user') {
      return messages;
    }

    try {
      // Convert to agent input
      const agentInput: AgentInput = {
        type: 'user_request',
        content: latestMessage.content,
        metadata: {},
        timestamp: Date.now()
      };

      // Process through agent network
      const agentOutputs = await agentNetworkCoordinator.processInput(agentInput);
      
      // Find the best enhancement from grammar agents
      const grammarOutputs = agentOutputs.filter(output => 
        output.type === 'response' && output.confidence > 0.6
      );

      if (grammarOutputs.length > 0) {
        // Use the highest confidence grammar enhancement
        const bestOutput = grammarOutputs.sort((a, b) => b.confidence - a.confidence)[0];
        
        // Replace the user message with enhanced version
        const enhancedMessages = [...messages];
        enhancedMessages[enhancedMessages.length - 1] = {
          ...latestMessage,
          content: bestOutput.content
        };

        // Add system context from agents
        const networkMetrics = agentNetworkCoordinator.getNetworkMetrics();
        const contextMessage = {
          role: 'assistant' as const, // Changed to assistant since system is not allowed
          content: `[Cognitive Agent Network] Enhanced request with ${networkMetrics.activeAgents} active agents. Collaboration score: ${(networkMetrics.collaborationScore * 100).toFixed(1)}%`
        };

        return [...enhancedMessages, contextMessage];
      }

    } catch (error) {
      console.warn('Failed to enhance messages with cognitive agents:', error);
    }

    return messages;
  }

  async processAgentActions(agentOutputs: AgentOutput[]): Promise<string[]> {
    const actionResults: string[] = [];

    for (const output of agentOutputs) {
      if (output.actions.length > 0) {
        // Convert agent actions to Bolt actions
        for (const action of output.actions) {
          try {
            // Get execution agent to handle the action
            const executionAgents = agentNetworkCoordinator.getAgentsByType('execution');
            if (executionAgents.length > 0) {
              const executionAgent = executionAgents[0] as any; // Type assertion for specialized methods
              const result = await executionAgent.executeAction(action);
              actionResults.push(`Executed ${action.type}: ${result.output}`);
            }
          } catch (error) {
            console.error('Failed to execute agent action:', error);
            actionResults.push(`Failed to execute ${action.type}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      }
    }

    return actionResults;
  }

  async getNetworkStatus(): Promise<{
    status: string;
    metrics: any;
    agents: { id: string; type: string; status: string; capabilities: number }[];
  }> {
    await this.initialize();

    const metrics = agentNetworkCoordinator.getNetworkMetrics();
    const agents = ['grammar_001', 'context_001', 'planning_001', 'execution_001']
      .map(id => agentNetworkCoordinator.getAgent(id))
      .filter(Boolean)
      .map(agent => ({
        id: agent!.id,
        type: agent!.type,
        status: agent!.status,
        capabilities: agent!.capabilities.length
      }));

    return {
      status: metrics.activeAgents > 0 ? 'active' : 'idle',
      metrics,
      agents
    };
  }

  async shareKnowledge(content: string, type: 'pattern' | 'rule' | 'fact' | 'heuristic' = 'fact'): Promise<void> {
    await this.initialize();

    agentNetworkCoordinator.shareKnowledge({
      type,
      content,
      confidence: 0.8,
      context: ['user_interaction'],
      source: 'bolt_system'
    });
  }

  async queryContext(question: string): Promise<string> {
    await this.initialize();

    const contextAgents = agentNetworkCoordinator.getAgentsByType('context');
    if (contextAgents.length > 0) {
      const contextAgent = contextAgents[0] as any; // Type assertion for specialized methods
      const answer = contextAgent.queryContext(question);
      return answer.answer;
    }

    return 'No context agents available to answer the question.';
  }

  async planTask(task: string): Promise<{
    breakdown: any;
    estimatedDuration: number;
    requiredAgents: string[];
  }> {
    await this.initialize();

    const planningAgents = agentNetworkCoordinator.getAgentsByType('planning');
    if (planningAgents.length > 0) {
      const planningAgent = planningAgents[0] as any; // Type assertion for specialized methods
      const breakdown = planningAgent.decomposeTasks(task);
      
      return {
        breakdown,
        estimatedDuration: breakdown.estimatedDuration,
        requiredAgents: breakdown.subtasks.flatMap((task: any) => task.requiredSkills)
      };
    }

    return {
      breakdown: null,
      estimatedDuration: 0,
      requiredAgents: []
    };
  }
}

export const cognitiveAgentIntegration = new CognitiveAgentIntegration();
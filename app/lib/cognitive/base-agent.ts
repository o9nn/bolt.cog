/**
 * Base agent implementation with common functionality
 * All specialized agents extend from this base class.
 */

import type {
  Agent,
  AgentType,
  AgentCapability,
  AgentStatus,
  AgentInput,
  AgentMessage,
  AgentOutput,
  Perception,
  Reasoning,
  Experience,
  Knowledge,
} from '~/types/agents';
import type { CognitiveContext } from '~/types/cognitive-grammar';
import { cognitiveGrammarEngine } from './grammar-engine';

export abstract class BaseAgent implements Agent {
  id: string;
  name: string;
  abstract type: AgentType;
  capabilities: AgentCapability[] = [];
  status: AgentStatus = 'idle';
  context: CognitiveContext;
  private messageQueue: AgentMessage[] = [];
  private knowledgeBase: Knowledge[] = [];
  private experienceHistory: Experience[] = [];

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
    this.context = this.initializeContext();
    this.initializeCapabilities();
  }

  async perceive(input: AgentInput): Promise<Perception> {
    this.status = 'thinking';

    try {
      // use cognitive grammar engine to parse and understand input
      const parsed = cognitiveGrammarEngine.parseInput(input.content, this.context);

      // update context with new understanding
      this.context = cognitiveGrammarEngine.updateContext(input.content, this.context);

      const perception: Perception = {
        understood: parsed.intent.confidence > 0.1, // lower threshold for understanding
        confidence: Math.max(parsed.intent.confidence, 0.5), // ensure minimum confidence
        semanticNodes: parsed.semanticNodes,
        missingInfo: this.identifyMissingInfo(parsed),
        suggestedActions: this.generateSuggestions(parsed),
      };

      return perception;
    } catch (error) {
      console.error(`Error in perception for agent ${this.id}:`, error);
      return {
        understood: false,
        confidence: 0,
        semanticNodes: [],
        missingInfo: ['Failed to parse input'],
        suggestedActions: [],
      };
    } finally {
      this.status = 'idle';
    }
  }

  abstract reason(perception: Perception): Promise<Reasoning>;

  async act(reasoning: Reasoning): Promise<AgentOutput> {
    this.status = 'acting';

    try {
      const output = await this.executeReasoning(reasoning);

      // record experience
      const experience: Experience = {
        situation: JSON.stringify(reasoning.steps),
        action: output.type,
        outcome: output.confidence > 0.7 ? 'success' : 'partial',
        feedback: output.content,
        success: output.confidence > 0.5,
        lessons: this.extractLessons(reasoning, output),
      };

      this.updateKnowledge(experience);

      return output;
    } catch (error) {
      console.error(`Error in action for agent ${this.id}:`, error);
      this.status = 'error';

      return {
        type: 'response',
        content: `Error executing actions: ${error instanceof Error ? error.message : 'Unknown error'}`,
        actions: [],
        messages: [],
        confidence: 0,
        nextSteps: ['Review error and retry'],
      };
    } finally {
      if (this.status !== 'error') {
        this.status = 'idle';
      }
    }
  }

  async sendMessage(targetAgent: string, message: AgentMessage): Promise<void> {
    this.status = 'communicating';

    // in a real implementation, this would send through the network coordinator
    console.log(`Agent ${this.id} sending message to ${targetAgent}:`, message.content);

    this.status = 'idle';
  }

  async receiveMessage(message: AgentMessage): Promise<void> {
    this.messageQueue.push(message);

    // process message based on type
    if (message.type === 'request' && message.urgency === 'critical') {
      await this.processMessage(message);
    }
  }

  updateKnowledge(experience: Experience): void {
    this.experienceHistory.push(experience);

    // convert significant experiences to knowledge
    if (experience.success && experience.lessons.length > 0) {
      const knowledge: Knowledge = {
        type: 'heuristic',
        content: experience.lessons.join(', '),
        confidence: 0.8,
        context: [experience.situation],
        source: this.id,
      };

      this.knowledgeBase.push(knowledge);
    }

    // keep only recent experiences to prevent memory bloat
    const cutoff = Date.now() - 3600000; // 1 hour
    this.experienceHistory = this.experienceHistory.filter((exp) => new Date(exp.situation).getTime() > cutoff);
  }

  shareKnowledge(knowledge: Knowledge): void {
    this.knowledgeBase.push(knowledge);
  }

  protected abstract initializeCapabilities(): void;

  protected abstract executeReasoning(reasoning: Reasoning): Promise<AgentOutput>;

  private initializeContext(): CognitiveContext {
    return {
      projectStructure: [],
      codeRelations: [],
      userIntent: {
        goal: '',
        entities: [],
        actions: [],
        constraints: [],
        confidence: 0,
      },
      executionHistory: [],
    };
  }

  private identifyMissingInfo(parsed: any): string[] {
    const missing: string[] = [];

    if (parsed.intent.confidence < 0.5) {
      missing.push('Intent unclear - please provide more specific instructions');
    }

    if (parsed.intent.entities.length === 0) {
      missing.push('No specific entities identified - what should be created/modified?');
    }

    if (parsed.intent.actions.length === 0) {
      missing.push('No clear actions identified - what should be done?');
    }

    return missing;
  }

  private generateSuggestions(parsed: any): string[] {
    const suggestions: string[] = [];

    // apply cognitive grammar rules to enhance suggestions
    const enhanced = cognitiveGrammarEngine.applyRules(parsed);

    if (enhanced !== parsed.text) {
      suggestions.push(enhanced);
    }

    // add agent-specific suggestions based on capabilities
    for (const capability of this.capabilities) {
      if (
        parsed.intent.actions.some(
          (action: string) =>
            capability.inputTypes.includes(action) || capability.name.toLowerCase().includes(action.toLowerCase()),
        )
      ) {
        suggestions.push(`Consider using ${capability.name}: ${capability.description}`);
      }
    }

    return suggestions;
  }

  private async processMessage(message: AgentMessage): Promise<void> {
    // convert message to agent input and process
    const input: AgentInput = {
      type: 'agent_message',
      content: message.content,
      metadata: message.metadata,
      timestamp: message.timestamp,
      sourceAgent: message.fromAgent,
    };

    try {
      const perception = await this.perceive(input);

      if (perception.understood) {
        const reasoning = await this.reason(perception);
        await this.act(reasoning);
      }
    } catch (error) {
      console.error(`Error processing message in agent ${this.id}:`, error);
    }
  }

  private extractLessons(reasoning: Reasoning, output: AgentOutput): string[] {
    const lessons: string[] = [];

    if (output.confidence > 0.8) {
      lessons.push(`${reasoning.strategy} strategy was effective for this type of task`);
    }

    if (reasoning.steps.length > 5 && output.confidence > 0.7) {
      lessons.push('Complex multi-step reasoning can be successful with proper breakdown');
    }

    if (output.messages.length > 0) {
      lessons.push('Collaboration with other agents improved outcome quality');
    }

    return lessons;
  }

  // utility methods for derived classes
  protected createCapability(
    name: string,
    description: string,
    inputTypes: string[],
    outputTypes: string[],
    confidence: number = 0.8,
  ): AgentCapability {
    return {
      name,
      description,
      inputTypes,
      outputTypes,
      confidence,
    };
  }

  protected findRelevantKnowledge(_context: string[]): Knowledge[] {
    return this.knowledgeBase.filter((knowledge) =>
      knowledge.context.some((ctx) => _context.some((c) => c.toLowerCase().includes(ctx.toLowerCase()))),
    );
  }

  protected getRecentExperiences(count: number = 5): Experience[] {
    return this.experienceHistory
      .sort((a, b) => new Date(b.situation).getTime() - new Date(a.situation).getTime())
      .slice(0, count);
  }
}

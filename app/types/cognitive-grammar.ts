/**
 * Core types for cognitive grammar system
 * Defines semantic understanding and contextual relationships
 */

// Cognitive Grammar Core Concepts
export interface SemanticNode {
  id: string;
  type: 'concept' | 'relation' | 'entity' | 'action';
  content: string;
  metadata: Record<string, unknown>;
  connections: SemanticConnection[];
}

export interface SemanticConnection {
  targetId: string;
  type: 'dependency' | 'similarity' | 'causality' | 'composition';
  strength: number; // 0-1 confidence score
  metadata?: Record<string, unknown>;
}

export interface CognitiveContext {
  projectStructure: SemanticNode[];
  codeRelations: SemanticConnection[];
  userIntent: IntentModel;
  executionHistory: ExecutionMemory[];
}

export interface IntentModel {
  goal: string;
  entities: string[];
  actions: string[];
  constraints: string[];
  confidence: number;
}

export interface ExecutionMemory {
  action: string;
  context: Record<string, unknown>;
  result: 'success' | 'failure' | 'partial';
  timestamp: number;
  learnings: string[];
}

// Grammar Rule System
export interface GrammarRule {
  id: string;
  pattern: string; // regex or template pattern
  transform: (input: string, context: CognitiveContext) => string;
  conditions: RuleCondition[];
  priority: number;
}

export interface RuleCondition {
  type: 'context' | 'syntax' | 'semantic' | 'pragmatic';
  check: (context: CognitiveContext) => boolean;
}

export interface GrammarEngine {
  parseInput(input: string, context: CognitiveContext): ParsedInput;
  applyRules(input: ParsedInput, rules: GrammarRule[]): string;
  updateContext(result: string, context: CognitiveContext): CognitiveContext;
}

export interface ParsedInput {
  text: string;
  tokens: Token[];
  semanticNodes: SemanticNode[];
  intent: IntentModel;
}

export interface Token {
  type: 'keyword' | 'identifier' | 'operator' | 'literal' | 'comment';
  value: string;
  position: number;
  semanticRole?: string;
}
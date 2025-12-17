/**
 * Core cognitive grammar engine implementation
 * Provides semantic understanding and contextual reasoning
 */

import type {
  CognitiveContext,
  SemanticNode,
  SemanticConnection,
  GrammarRule,
  GrammarEngine,
  ParsedInput,
  Token,
  IntentModel,
  RuleCondition
} from '~/types/cognitive-grammar';

export class CognitiveGrammarEngine implements GrammarEngine {
  private rules: GrammarRule[] = [];
  private builtInRules: GrammarRule[] = [];

  constructor() {
    this.initializeBuiltInRules();
  }

  parseInput(input: string, context: CognitiveContext): ParsedInput {
    const tokens = this.tokenize(input);
    const semanticNodes = this.extractSemanticNodes(tokens, context);
    const intent = this.deriveIntent(tokens, semanticNodes, context);

    return {
      text: input,
      tokens,
      semanticNodes,
      intent
    };
  }

  applyRules(input: ParsedInput, rules: GrammarRule[] = this.rules): string {
    const allRules = [...this.builtInRules, ...rules].sort((a, b) => b.priority - a.priority);
    let result = input.text;

    for (const rule of allRules) {
      if (this.evaluateConditions(rule.conditions, input)) {
        try {
          const pattern = new RegExp(rule.pattern, 'gi');
          if (pattern.test(result)) {
            // Create a mock context for the transform function
            const mockContext: CognitiveContext = {
              projectStructure: input.semanticNodes,
              codeRelations: [],
              userIntent: input.intent,
              executionHistory: []
            };
            result = rule.transform(result, mockContext);
          }
        } catch (error) {
          console.warn(`Failed to apply rule ${rule.id}:`, error);
        }
      }
    }

    return result;
  }

  updateContext(result: string, context: CognitiveContext): CognitiveContext {
    const newNodes = this.extractSemanticNodes(this.tokenize(result), context);
    const updatedStructure = this.mergeSemanticNodes(context.projectStructure, newNodes);
    
    return {
      ...context,
      projectStructure: updatedStructure,
      codeRelations: this.inferRelations(updatedStructure)
    };
  }

  addRule(rule: GrammarRule): void {
    this.rules.push(rule);
  }

  removeRule(ruleId: string): void {
    this.rules = this.rules.filter(rule => rule.id !== ruleId);
  }

  private tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    
    // Simple tokenization patterns
    const patterns = [
      { type: 'keyword' as const, regex: /\b(create|update|delete|modify|add|remove|build|test|run|install|import|export|function|class|const|let|var|if|else|for|while|return)\b/g },
      { type: 'identifier' as const, regex: /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g },
      { type: 'operator' as const, regex: /[+\-*/%=<>!&|^~]+/g },
      { type: 'literal' as const, regex: /"[^"]*"|'[^']*'|`[^`]*`|\b\d+(\.\d+)?\b/g },
      { type: 'comment' as const, regex: /\/\/.*$|\/\*[\s\S]*?\*\//gm }
    ];

    let position = 0;
    const processed = new Set<number>();

    for (const { type, regex } of patterns) {
      regex.lastIndex = 0;
      let match;
      
      while ((match = regex.exec(input)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        
        // Avoid overlapping tokens
        let overlap = false;
        for (let i = start; i < end; i++) {
          if (processed.has(i)) {
            overlap = true;
            break;
          }
        }
        
        if (!overlap) {
          tokens.push({
            type,
            value: match[0],
            position: start,
            semanticRole: this.getSemanticRole(match[0], type)
          });
          
          for (let i = start; i < end; i++) {
            processed.add(i);
          }
        }
      }
    }

    return tokens.sort((a, b) => a.position - b.position);
  }

  private extractSemanticNodes(tokens: Token[], context: CognitiveContext): SemanticNode[] {
    const nodes: SemanticNode[] = [];
    const existingConcepts = new Set(context.projectStructure.map(n => n.content));

    // Extract entities and concepts from tokens
    for (const token of tokens) {
      if (token.type === 'identifier' && !existingConcepts.has(token.value)) {
        nodes.push({
          id: `concept_${token.value}_${Date.now()}`,
          type: 'concept',
          content: token.value,
          metadata: { 
            tokenType: token.type,
            position: token.position,
            semanticRole: token.semanticRole
          },
          connections: []
        });
      }

      if (token.type === 'keyword') {
        nodes.push({
          id: `action_${token.value}_${Date.now()}`,
          type: 'action',
          content: token.value,
          metadata: { 
            tokenType: token.type,
            position: token.position 
          },
          connections: []
        });
      }
    }

    return nodes;
  }

  private deriveIntent(tokens: Token[], semanticNodes: SemanticNode[], context: CognitiveContext): IntentModel {
    // Extract action words
    const actions = tokens
      .filter(t => t.type === 'keyword' && ['create', 'update', 'delete', 'modify', 'add', 'remove', 'build', 'test', 'run'].includes(t.value))
      .map(t => t.value);

    // Extract entities (identifiers that might be files, functions, etc.)
    const entities = tokens
      .filter(t => t.type === 'identifier')
      .map(t => t.value);

    // Simple goal derivation
    let goal = 'General development task';
    if (actions.length > 0) {
      const primaryAction = actions[0];
      const primaryEntity = entities.length > 0 ? entities[0] : 'code';
      goal = `${primaryAction} ${primaryEntity}`;
    }

    // Basic constraints detection
    const constraints: string[] = [];
    if (tokens.some(t => t.value.includes('test'))) {
      constraints.push('Ensure tests pass');
    }
    if (tokens.some(t => t.value.includes('component'))) {
      constraints.push('Follow component patterns');
    }

    return {
      goal,
      entities,
      actions,
      constraints,
      confidence: Math.max(0.5, Math.min(0.9, (actions.length + entities.length) / 5)) // Better confidence scoring
    };
  }

  private evaluateConditions(conditions: RuleCondition[], input: ParsedInput): boolean {
    return conditions.every(condition => {
      try {
        // Create a mock context for condition evaluation
        const mockContext: CognitiveContext = {
          projectStructure: input.semanticNodes,
          codeRelations: [],
          userIntent: input.intent,
          executionHistory: []
        };
        return condition.check(mockContext);
      } catch (error) {
        console.warn('Failed to evaluate condition:', error);
        return false;
      }
    });
  }

  private mergeSemanticNodes(existing: SemanticNode[], newNodes: SemanticNode[]): SemanticNode[] {
    const merged = [...existing];
    const existingIds = new Set(existing.map(n => n.content));

    for (const newNode of newNodes) {
      if (!existingIds.has(newNode.content)) {
        merged.push(newNode);
      }
    }

    return merged;
  }

  private inferRelations(nodes: SemanticNode[]): SemanticConnection[] {
    const relations: SemanticConnection[] = [];

    // Simple relation inference based on proximity and semantic similarity
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i];
        const nodeB = nodes[j];

        // Infer dependency if one is an action and other is a concept
        if (nodeA.type === 'action' && nodeB.type === 'concept') {
          relations.push({
            targetId: nodeB.id,
            type: 'dependency',
            strength: 0.6,
            metadata: { inferredFrom: 'action-concept pattern' }
          });
        }

        // Infer similarity based on content similarity
        const similarity = this.calculateSimilarity(nodeA.content, nodeB.content);
        if (similarity > 0.5) {
          relations.push({
            targetId: nodeB.id,
            type: 'similarity',
            strength: similarity,
            metadata: { inferredFrom: 'content similarity' }
          });
        }
      }
    }

    return relations;
  }

  private calculateSimilarity(a: string, b: string): number {
    const setA = new Set(a.toLowerCase().split(''));
    const setB = new Set(b.toLowerCase().split(''));
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
  }

  private getSemanticRole(value: string, type: Token['type']): string | undefined {
    if (type === 'keyword') {
      const actionWords = ['create', 'update', 'delete', 'modify', 'add', 'remove'];
      if (actionWords.includes(value)) return 'action';
      
      const structureWords = ['function', 'class', 'const', 'let', 'var'];
      if (structureWords.includes(value)) return 'structure';
    }

    if (type === 'identifier') {
      // Simple heuristics for semantic roles
      if (value.endsWith('Component') || value.endsWith('Widget')) return 'component';
      if (value.endsWith('Service') || value.endsWith('Manager')) return 'service';
      if (value.startsWith('is') || value.startsWith('has')) return 'predicate';
    }

    return undefined;
  }

  private initializeBuiltInRules(): void {
    this.builtInRules = [
      {
        id: 'enhance-create-component',
        pattern: 'create.*component',
        priority: 10,
        conditions: [
          {
            type: 'context',
            check: (context) => context.userIntent.actions.includes('create')
          }
        ],
        transform: (input, context) => {
          const entityMatch = input.match(/create\s+(\w+)/i);
          const componentName = entityMatch ? entityMatch[1] : 'Component';
          return `Create a ${componentName} component with proper TypeScript types, following React best practices, including error boundaries and accessibility features.`;
        }
      },
      {
        id: 'enhance-file-operations',
        pattern: '(create|update|modify).*file',
        priority: 8,
        conditions: [
          {
            type: 'semantic',
            check: (context) => context.userIntent.entities.some(e => e.includes('file') || e.includes('File'))
          }
        ],
        transform: (input, context) => {
          return `${input} Ensure proper file structure, imports, and exports. Follow project conventions and add appropriate error handling.`;
        }
      },
      {
        id: 'add-testing-context',
        pattern: '(test|testing|spec)',
        priority: 7,
        conditions: [
          {
            type: 'context',
            check: (context) => context.userIntent.goal.includes('test')
          }
        ],
        transform: (input, context) => {
          return `${input} Include comprehensive test coverage with unit tests, integration tests where appropriate, and ensure tests follow established patterns in the codebase.`;
        }
      }
    ];
  }
}

export const cognitiveGrammarEngine = new CognitiveGrammarEngine();
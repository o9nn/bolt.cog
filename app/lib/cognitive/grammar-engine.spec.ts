/**
 * Tests for the cognitive grammar engine
 * Validates semantic understanding and rule application.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CognitiveGrammarEngine } from '~/lib/cognitive/grammar-engine';
import type { CognitiveContext, GrammarRule } from '~/types/cognitive-grammar';

describe('CognitiveGrammarEngine', () => {
  let engine: CognitiveGrammarEngine;
  let mockContext: CognitiveContext;

  beforeEach(() => {
    engine = new CognitiveGrammarEngine();
    mockContext = {
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
  });

  describe('parseInput', () => {
    it('should tokenize input correctly', () => {
      const input = 'create a new component';
      const result = engine.parseInput(input, mockContext);

      expect(result.tokens).toHaveLength(4);
      expect(result.tokens[0]).toEqual({
        type: 'keyword',
        value: 'create',
        _position: 0,
        semanticRole: 'action',
      });
    });

    it('should extract semantic nodes', () => {
      const input = 'create a TodoComponent';
      const result = engine.parseInput(input, mockContext);

      expect(result._semanticNodes.length).toBeGreaterThanOrEqual(2);
      expect(result._semanticNodes.find((n) => n.content === 'create')).toBeDefined();
      expect(result._semanticNodes.find((n) => n.content === 'TodoComponent')).toBeDefined();
    });

    it('should derive intent correctly', () => {
      const input = 'create a new React component for todos';
      const result = engine.parseInput(input, mockContext);

      expect(result.intent.actions).toContain('create');
      expect(result.intent.entities).toContain('component');
      expect(result.intent.goal).toContain('create');
      expect(result.intent.confidence).toBeGreaterThan(0);
    });
  });

  describe('applyRules', () => {
    it('should apply built-in grammar rules', () => {
      const input = 'create component';
      const parsed = engine.parseInput(input, mockContext);
      const enhanced = engine.applyRules(parsed);

      expect(enhanced).toContain('component with proper TypeScript types');
      expect(enhanced).toContain('React best practices');
    });

    it('should apply custom rules', () => {
      const customRule: GrammarRule = {
        id: 'test-rule',
        pattern: 'test.*function',
        priority: 5,
        conditions: [
          {
            type: 'context',
            check: () => true,
          },
        ],
        transform: (input) => `${input} with comprehensive testing`,
      };

      engine.addRule(customRule);

      const input = 'test function';
      const parsed = engine.parseInput(input, mockContext);
      const enhanced = engine.applyRules(parsed);

      expect(enhanced).toContain('with comprehensive testing');
    });

    it('should not apply rules when conditions fail', () => {
      const customRule: GrammarRule = {
        id: 'conditional-rule',
        pattern: 'create.*',
        priority: 5,
        conditions: [
          {
            type: 'context',
            check: () => false, // always fail
          },
        ],
        transform: (input) => `${input} SHOULD_NOT_APPEAR`,
      };

      engine.addRule(customRule);

      const input = 'create something';
      const parsed = engine.parseInput(input, mockContext);
      const enhanced = engine.applyRules(parsed);

      expect(enhanced).not.toContain('SHOULD_NOT_APPEAR');
    });
  });

  describe('updateContext', () => {
    it('should update _context with new semantic understanding', () => {
      const result = 'function calculateTotal() { return 42; }';
      const updatedContext = engine.updateContext(result, mockContext);

      expect(updatedContext.projectStructure.length).toBeGreaterThan(mockContext.projectStructure.length);
      expect(updatedContext.codeRelations.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('rule management', () => {
    it('should add custom rules', () => {
      const rule: GrammarRule = {
        id: 'test-rule',
        pattern: 'test',
        priority: 1,
        conditions: [],
        transform: (input) => input,
      };

      engine.addRule(rule);

      // rule should be added (internal state, can't directly test but can test its effect)

      const input = 'test';
      const parsed = engine.parseInput(input, mockContext);
      const result = engine.applyRules(parsed);

      // should not throw an error
      expect(result).toBeDefined();
    });

    it('should remove rules by id', () => {
      const rule: GrammarRule = {
        id: 'removable-rule',
        pattern: 'remove.*me',
        priority: 1,
        conditions: [],
        transform: () => 'REMOVED_RULE_APPLIED',
      };

      engine.addRule(rule);
      engine.removeRule('removable-rule');

      const input = 'remove me';
      const parsed = engine.parseInput(input, mockContext);
      const result = engine.applyRules(parsed);

      expect(result).not.toContain('REMOVED_RULE_APPLIED');
    });
  });

  describe('semantic role detection', () => {
    it('should identify component identifiers', () => {
      const input = 'MyComponent SomeWidget';
      const result = engine.parseInput(input, mockContext);

      const componentToken = result.tokens.find((t) => t.value === 'MyComponent');
      const widgetToken = result.tokens.find((t) => t.value === 'SomeWidget');

      expect(componentToken?.semanticRole).toBe('component');
      expect(widgetToken?.semanticRole).toBe('component');
    });

    it('should identify service classes', () => {
      const input = 'UserService DataManager';
      const result = engine.parseInput(input, mockContext);

      const serviceToken = result.tokens.find((t) => t.value === 'UserService');
      const managerToken = result.tokens.find((t) => t.value === 'DataManager');

      expect(serviceToken?.semanticRole).toBe('service');
      expect(managerToken?.semanticRole).toBe('service');
    });

    it('should identify predicate functions', () => {
      const input = 'isValid hasPermission';
      const result = engine.parseInput(input, mockContext);

      const isToken = result.tokens.find((t) => t.value === 'isValid');
      const hasToken = result.tokens.find((t) => t.value === 'hasPermission');

      expect(isToken?.semanticRole).toBe('predicate');
      expect(hasToken?.semanticRole).toBe('predicate');
    });
  });
});

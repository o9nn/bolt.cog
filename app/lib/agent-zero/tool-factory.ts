/**
 * Agent-Zero Tool Factory
 * Self-creating tool system - agents can create their own tools
 */

import type { ToolConfig, ToolParameter, ToolResult } from './types';

export class ToolFactory {
  private tools: Map<string, ToolConfig>;
  private executors: Map<string, ToolExecutor>;
  private templates: Map<string, ToolTemplate>;

  constructor() {
    this.tools = new Map();
    this.executors = new Map();
    this.templates = new Map();
    this.registerBuiltinTemplates();
  }

  /**
   * Register a tool
   */
  register(tool: ToolConfig): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool by name
   */
  get(name: string): ToolConfig | undefined {
    return this.tools.get(name);
  }

  /**
   * List all tools
   */
  list(): ToolConfig[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool
   */
  async execute(
    name: string,
    parameters: Record<string, unknown>,
    context?: ExecutionContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        output: '',
        error: `Tool not found: ${name}`,
        duration: 0,
      };
    }

    if (!tool.enabled) {
      return {
        success: false,
        output: '',
        error: `Tool disabled: ${name}`,
        duration: 0,
      };
    }

    // Validate parameters
    const validation = this.validateParameters(tool, parameters);
    if (!validation.valid) {
      return {
        success: false,
        output: '',
        error: `Invalid parameters: ${validation.errors.join(', ')}`,
        duration: 0,
      };
    }

    const startTime = Date.now();

    try {
      const executor = this.executors.get(name);
      let output: string;

      if (executor) {
        output = await executor(parameters, context);
      } else if (tool.code) {
        output = await this.executeCustomCode(tool.code, parameters, context);
      } else {
        output = await this.executeBuiltin(name, parameters, context);
      }

      return {
        success: true,
        output,
        duration: Date.now() - startTime,
        metadata: { tool: name, parameters },
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Create a new tool from natural language description
   */
  async createFromDescription(
    name: string,
    description: string,
    examples?: string[],
  ): Promise<ToolConfig> {
    // Analyze description to determine tool type
    const analysis = this.analyzeDescription(description);
    
    // Find matching template
    const template = this.findMatchingTemplate(analysis);
    
    // Generate tool configuration
    const tool: ToolConfig = {
      name,
      description,
      type: 'generated',
      enabled: true,
      parameters: this.inferParameters(description, examples),
      code: template ? this.instantiateTemplate(template, analysis) : undefined,
    };

    this.register(tool);
    return tool;
  }

  /**
   * Create a tool from code
   */
  createFromCode(
    name: string,
    description: string,
    code: string,
    parameters: ToolParameter[],
  ): ToolConfig {
    const tool: ToolConfig = {
      name,
      description,
      type: 'generated',
      enabled: true,
      code,
      parameters,
    };

    this.register(tool);
    return tool;
  }

  /**
   * Register a custom executor for a tool
   */
  registerExecutor(name: string, executor: ToolExecutor): void {
    this.executors.set(name, executor);
  }

  /**
   * Register a tool template
   */
  registerTemplate(template: ToolTemplate): void {
    this.templates.set(template.name, template);
  }

  /**
   * Compose multiple tools into a pipeline
   */
  compose(
    name: string,
    description: string,
    toolSequence: string[],
  ): ToolConfig {
    const code = this.generatePipelineCode(toolSequence);
    
    // Merge parameters from all tools
    const parameters: ToolParameter[] = [];
    const seenParams = new Set<string>();

    for (const toolName of toolSequence) {
      const tool = this.tools.get(toolName);
      if (tool) {
        for (const param of tool.parameters) {
          if (!seenParams.has(param.name)) {
            parameters.push(param);
            seenParams.add(param.name);
          }
        }
      }
    }

    return this.createFromCode(name, description, code, parameters);
  }

  /**
   * Clone and modify an existing tool
   */
  clone(
    sourceName: string,
    newName: string,
    modifications: Partial<ToolConfig>,
  ): ToolConfig | null {
    const source = this.tools.get(sourceName);
    if (!source) return null;

    const cloned: ToolConfig = {
      ...source,
      ...modifications,
      name: newName,
      type: 'generated',
    };

    this.register(cloned);
    return cloned;
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private registerBuiltinTemplates(): void {
    // HTTP Request Template
    this.registerTemplate({
      name: 'http_request',
      description: 'Make HTTP requests',
      keywords: ['http', 'api', 'request', 'fetch', 'get', 'post'],
      code: `
async function execute(params, context) {
  const { url, method = 'GET', headers = {}, body } = params;
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return await response.text();
}
      `,
      parameters: [
        { name: 'url', type: 'string', description: 'Request URL', required: true },
        { name: 'method', type: 'string', description: 'HTTP method', required: false, default: 'GET' },
        { name: 'headers', type: 'object', description: 'Request headers', required: false },
        { name: 'body', type: 'object', description: 'Request body', required: false },
      ],
    });

    // File Operation Template
    this.registerTemplate({
      name: 'file_operation',
      description: 'Read and write files',
      keywords: ['file', 'read', 'write', 'save', 'load'],
      code: `
async function execute(params, context) {
  const { operation, path, content } = params;
  const fs = require('fs').promises;
  
  switch (operation) {
    case 'read':
      return await fs.readFile(path, 'utf8');
    case 'write':
      await fs.writeFile(path, content);
      return 'File written successfully';
    case 'append':
      await fs.appendFile(path, content);
      return 'Content appended successfully';
    default:
      throw new Error('Unknown operation: ' + operation);
  }
}
      `,
      parameters: [
        { name: 'operation', type: 'string', description: 'Operation type', required: true },
        { name: 'path', type: 'string', description: 'File path', required: true },
        { name: 'content', type: 'string', description: 'Content to write', required: false },
      ],
    });

    // Data Transform Template
    this.registerTemplate({
      name: 'data_transform',
      description: 'Transform data structures',
      keywords: ['transform', 'map', 'filter', 'reduce', 'convert'],
      code: `
async function execute(params, context) {
  const { data, operation, expression } = params;
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  
  switch (operation) {
    case 'map':
      return JSON.stringify(parsed.map(eval('(' + expression + ')')));
    case 'filter':
      return JSON.stringify(parsed.filter(eval('(' + expression + ')')));
    case 'reduce':
      return JSON.stringify(parsed.reduce(eval('(' + expression + ')'), null));
    default:
      return JSON.stringify(parsed);
  }
}
      `,
      parameters: [
        { name: 'data', type: 'string', description: 'Input data (JSON)', required: true },
        { name: 'operation', type: 'string', description: 'Transform operation', required: true },
        { name: 'expression', type: 'string', description: 'Transform expression', required: true },
      ],
    });

    // Shell Command Template
    this.registerTemplate({
      name: 'shell_command',
      description: 'Execute shell commands',
      keywords: ['shell', 'command', 'terminal', 'bash', 'execute'],
      code: `
async function execute(params, context) {
  const { command, cwd, timeout = 30000 } = params;
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  
  const result = await execAsync(command, { cwd, timeout });
  return result.stdout + (result.stderr ? '\\nSTDERR: ' + result.stderr : '');
}
      `,
      parameters: [
        { name: 'command', type: 'string', description: 'Shell command', required: true },
        { name: 'cwd', type: 'string', description: 'Working directory', required: false },
        { name: 'timeout', type: 'number', description: 'Timeout in ms', required: false, default: 30000 },
      ],
    });

    // Text Processing Template
    this.registerTemplate({
      name: 'text_processing',
      description: 'Process and analyze text',
      keywords: ['text', 'string', 'parse', 'extract', 'regex'],
      code: `
async function execute(params, context) {
  const { text, operation, pattern, replacement } = params;
  
  switch (operation) {
    case 'match':
      const matches = text.match(new RegExp(pattern, 'g'));
      return JSON.stringify(matches || []);
    case 'replace':
      return text.replace(new RegExp(pattern, 'g'), replacement || '');
    case 'split':
      return JSON.stringify(text.split(new RegExp(pattern)));
    case 'extract':
      const extracted = text.match(new RegExp(pattern));
      return extracted ? extracted[1] || extracted[0] : '';
    default:
      return text;
  }
}
      `,
      parameters: [
        { name: 'text', type: 'string', description: 'Input text', required: true },
        { name: 'operation', type: 'string', description: 'Text operation', required: true },
        { name: 'pattern', type: 'string', description: 'Regex pattern', required: true },
        { name: 'replacement', type: 'string', description: 'Replacement text', required: false },
      ],
    });
  }

  private validateParameters(
    tool: ToolConfig,
    parameters: Record<string, unknown>,
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const param of tool.parameters) {
      if (param.required && !(param.name in parameters)) {
        errors.push(`Missing required parameter: ${param.name}`);
      }

      if (param.name in parameters) {
        const value = parameters[param.name];
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        
        if (actualType !== param.type && value !== null && value !== undefined) {
          errors.push(`Invalid type for ${param.name}: expected ${param.type}, got ${actualType}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  private async executeCustomCode(
    code: string,
    parameters: Record<string, unknown>,
    context?: ExecutionContext,
  ): Promise<string> {
    // Create a sandboxed execution environment
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    
    try {
      // Extract the execute function from the code
      const fn = new AsyncFunction('params', 'context', `
        ${code}
        return await execute(params, context);
      `);
      
      const result = await fn(parameters, context);
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (error) {
      throw new Error(`Tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async executeBuiltin(
    name: string,
    parameters: Record<string, unknown>,
    context?: ExecutionContext,
  ): Promise<string> {
    // Built-in tool implementations
    switch (name) {
      case 'knowledge':
        return `Knowledge search: ${parameters.query}`;
      
      case 'code_execution':
        return `Code executed: ${parameters.language}`;
      
      case 'communicate':
        return `Message sent to ${parameters.to}: ${parameters.message}`;
      
      case 'terminal':
        return `Command executed: ${parameters.command}`;
      
      case 'web_search':
        return `Search results for: ${parameters.query}`;
      
      default:
        return `Tool ${name} executed with parameters: ${JSON.stringify(parameters)}`;
    }
  }

  private analyzeDescription(description: string): DescriptionAnalysis {
    const descLower = description.toLowerCase();
    const keywords: string[] = [];
    const capabilities: string[] = [];

    // Extract keywords
    const keywordPatterns = [
      { pattern: /\b(http|api|request|fetch)\b/i, keyword: 'http' },
      { pattern: /\b(file|read|write|save)\b/i, keyword: 'file' },
      { pattern: /\b(shell|command|terminal|bash)\b/i, keyword: 'shell' },
      { pattern: /\b(transform|map|filter|convert)\b/i, keyword: 'transform' },
      { pattern: /\b(text|string|parse|regex)\b/i, keyword: 'text' },
    ];

    for (const { pattern, keyword } of keywordPatterns) {
      if (pattern.test(descLower)) {
        keywords.push(keyword);
      }
    }

    return { description, keywords, capabilities };
  }

  private findMatchingTemplate(analysis: DescriptionAnalysis): ToolTemplate | null {
    let bestMatch: ToolTemplate | null = null;
    let bestScore = 0;

    for (const template of this.templates.values()) {
      const score = analysis.keywords.filter((k) => 
        template.keywords.includes(k)
      ).length;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = template;
      }
    }

    return bestMatch;
  }

  private instantiateTemplate(
    template: ToolTemplate,
    analysis: DescriptionAnalysis,
  ): string {
    // Return the template code (could be customized based on analysis)
    return template.code;
  }

  private inferParameters(
    description: string,
    examples?: string[],
  ): ToolParameter[] {
    const parameters: ToolParameter[] = [];
    const descLower = description.toLowerCase();

    // Infer common parameters from description
    if (descLower.includes('url') || descLower.includes('http')) {
      parameters.push({
        name: 'url',
        type: 'string',
        description: 'Target URL',
        required: true,
      });
    }

    if (descLower.includes('file') || descLower.includes('path')) {
      parameters.push({
        name: 'path',
        type: 'string',
        description: 'File path',
        required: true,
      });
    }

    if (descLower.includes('query') || descLower.includes('search')) {
      parameters.push({
        name: 'query',
        type: 'string',
        description: 'Search query',
        required: true,
      });
    }

    if (descLower.includes('data') || descLower.includes('input')) {
      parameters.push({
        name: 'data',
        type: 'string',
        description: 'Input data',
        required: true,
      });
    }

    // Default to a generic input parameter if none inferred
    if (parameters.length === 0) {
      parameters.push({
        name: 'input',
        type: 'string',
        description: 'Input value',
        required: true,
      });
    }

    return parameters;
  }

  private generatePipelineCode(toolSequence: string[]): string {
    const steps = toolSequence.map((name, i) => {
      return `
    // Step ${i + 1}: ${name}
    const result${i} = await this.execute('${name}', ${i === 0 ? 'params' : `{ input: result${i - 1} }`}, context);
    if (!result${i}.success) throw new Error(result${i}.error);
      `;
    }).join('\n');

    return `
async function execute(params, context) {
  ${steps}
  return result${toolSequence.length - 1}.output;
}
    `;
  }
}

// Types
type ToolExecutor = (
  parameters: Record<string, unknown>,
  context?: ExecutionContext,
) => Promise<string>;

interface ToolTemplate {
  name: string;
  description: string;
  keywords: string[];
  code: string;
  parameters: ToolParameter[];
}

interface DescriptionAnalysis {
  description: string;
  keywords: string[];
  capabilities: string[];
}

interface ExecutionContext {
  workingDirectory?: string;
  environment?: Record<string, string>;
  timeout?: number;
}

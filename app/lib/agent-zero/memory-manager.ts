/**
 * Agent-Zero Memory Manager
 * Persistent, organic memory system that grows with the agent
 */

import type { Memory, MemoryConfig, MemoryMetadata } from './types';

export class MemoryManager {
  private memories: Map<string, Memory>;
  private config: MemoryConfig;
  private embeddings: Map<string, number[]>;

  constructor(config: MemoryConfig) {
    this.config = config;
    this.memories = new Map();
    this.embeddings = new Map();
  }

  /**
   * Store a new memory
   */
  async store(memory: Omit<Memory, 'id' | 'timestamp' | 'accessCount'>): Promise<Memory> {
    const fullMemory: Memory = {
      ...memory,
      id: this.generateId(),
      timestamp: Date.now(),
      accessCount: 0,
    };

    // Generate embedding if enabled
    if (this.config.enabled) {
      const embedding = await this.generateEmbedding(memory.content);
      fullMemory.embedding = embedding;
      this.embeddings.set(fullMemory.id, embedding);
    }

    // Enforce max memories limit
    if (this.memories.size >= this.config.maxMemories) {
      await this.evictLeastRelevant();
    }

    this.memories.set(fullMemory.id, fullMemory);
    return fullMemory;
  }

  /**
   * Retrieve memories by semantic similarity
   */
  async retrieve(query: string, limit: number = 5): Promise<Memory[]> {
    if (!this.config.enabled || this.memories.size === 0) {
      return [];
    }

    const queryEmbedding = await this.generateEmbedding(query);
    
    const scored = Array.from(this.memories.values()).map((memory) => {
      const similarity = memory.embedding
        ? this.cosineSimilarity(queryEmbedding, memory.embedding)
        : this.keywordSimilarity(query, memory.content);
      
      // Boost by recency and access count
      const recencyBoost = 1 / (1 + (Date.now() - memory.timestamp) / (1000 * 60 * 60 * 24));
      const accessBoost = Math.log(memory.accessCount + 1) / 10;
      
      return {
        memory,
        score: similarity + recencyBoost * 0.1 + accessBoost * 0.05,
      };
    });

    const results = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => {
        // Increment access count
        item.memory.accessCount++;
        return item.memory;
      });

    return results;
  }

  /**
   * Retrieve memories by type
   */
  getByType(type: Memory['type']): Memory[] {
    return Array.from(this.memories.values()).filter((m) => m.type === type);
  }

  /**
   * Retrieve memories by tags
   */
  getByTags(tags: string[]): Memory[] {
    return Array.from(this.memories.values()).filter((m) =>
      tags.some((tag) => m.metadata.tags.includes(tag))
    );
  }

  /**
   * Update a memory
   */
  async update(id: string, updates: Partial<Memory>): Promise<Memory | null> {
    const memory = this.memories.get(id);
    if (!memory) return null;

    const updated = { ...memory, ...updates };
    
    // Regenerate embedding if content changed
    if (updates.content && this.config.enabled) {
      updated.embedding = await this.generateEmbedding(updates.content);
      this.embeddings.set(id, updated.embedding);
    }

    this.memories.set(id, updated);
    return updated;
  }

  /**
   * Delete a memory
   */
  delete(id: string): boolean {
    this.embeddings.delete(id);
    return this.memories.delete(id);
  }

  /**
   * Consolidate related memories
   */
  async consolidate(): Promise<number> {
    const clusters = await this.clusterMemories();
    let consolidated = 0;

    for (const cluster of clusters) {
      if (cluster.length > 2) {
        // Merge similar memories
        const merged = this.mergeMemories(cluster);
        
        // Delete old memories
        cluster.forEach((m) => this.delete(m.id));
        
        // Store merged memory
        await this.store(merged);
        consolidated += cluster.length - 1;
      }
    }

    return consolidated;
  }

  /**
   * Export memories for persistence
   */
  export(): Memory[] {
    return Array.from(this.memories.values());
  }

  /**
   * Import memories from persistence
   */
  import(memories: Memory[]): void {
    memories.forEach((m) => {
      this.memories.set(m.id, m);
      if (m.embedding) {
        this.embeddings.set(m.id, m.embedding);
      }
    });
  }

  /**
   * Get memory statistics
   */
  getStats(): MemoryStats {
    const memories = Array.from(this.memories.values());
    
    const byType = memories.reduce((acc, m) => {
      acc[m.type] = (acc[m.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const avgConfidence = memories.reduce((acc, m) => acc + m.metadata.confidence, 0) / memories.length;
    const avgRelevance = memories.reduce((acc, m) => acc + m.relevanceScore, 0) / memories.length;

    return {
      total: memories.length,
      byType,
      avgConfidence: avgConfidence || 0,
      avgRelevance: avgRelevance || 0,
      oldestTimestamp: Math.min(...memories.map((m) => m.timestamp)),
      newestTimestamp: Math.max(...memories.map((m) => m.timestamp)),
    };
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private async generateEmbedding(text: string): Promise<number[]> {
    // Simple TF-IDF-like embedding (would use actual embedding model in production)
    const words = text.toLowerCase().split(/\s+/);
    const vocab = new Set(words);
    const embedding = new Array(256).fill(0);

    words.forEach((word, i) => {
      const hash = this.hashString(word);
      embedding[hash % 256] += 1 / (i + 1);
    });

    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((acc, v) => acc + v * v, 0));
    return embedding.map((v) => v / (magnitude || 1));
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  private keywordSimilarity(query: string, content: string): number {
    const queryWords = new Set(query.toLowerCase().split(/\s+/));
    const contentWords = new Set(content.toLowerCase().split(/\s+/));
    
    let matches = 0;
    queryWords.forEach((word) => {
      if (contentWords.has(word)) matches++;
    });

    return matches / queryWords.size;
  }

  private async evictLeastRelevant(): Promise<void> {
    const memories = Array.from(this.memories.values());
    
    // Score by relevance, recency, and access count
    const scored = memories.map((m) => ({
      memory: m,
      score: m.relevanceScore * 0.5 + 
             (m.accessCount / 100) * 0.3 + 
             (1 - (Date.now() - m.timestamp) / (1000 * 60 * 60 * 24 * 30)) * 0.2,
    }));

    // Remove lowest scoring
    const toRemove = scored
      .sort((a, b) => a.score - b.score)
      .slice(0, Math.ceil(memories.length * 0.1));

    toRemove.forEach((item) => this.delete(item.memory.id));
  }

  private async clusterMemories(): Promise<Memory[][]> {
    const memories = Array.from(this.memories.values());
    const clusters: Memory[][] = [];
    const assigned = new Set<string>();

    for (const memory of memories) {
      if (assigned.has(memory.id)) continue;

      const cluster = [memory];
      assigned.add(memory.id);

      // Find similar memories
      for (const other of memories) {
        if (assigned.has(other.id)) continue;

        if (memory.embedding && other.embedding) {
          const similarity = this.cosineSimilarity(memory.embedding, other.embedding);
          if (similarity > 0.8) {
            cluster.push(other);
            assigned.add(other.id);
          }
        }
      }

      clusters.push(cluster);
    }

    return clusters;
  }

  private mergeMemories(memories: Memory[]): Omit<Memory, 'id' | 'timestamp' | 'accessCount'> {
    // Combine content
    const content = memories.map((m) => m.content).join('\n---\n');
    
    // Merge metadata
    const allTags = new Set<string>();
    const allRelated = new Set<string>();
    let totalConfidence = 0;

    memories.forEach((m) => {
      m.metadata.tags.forEach((t) => allTags.add(t));
      m.metadata.relatedMemories.forEach((r) => allRelated.add(r));
      totalConfidence += m.metadata.confidence;
    });

    return {
      type: memories[0].type,
      content,
      metadata: {
        source: 'consolidation',
        context: memories.map((m) => m.metadata.context).flat(),
        tags: Array.from(allTags),
        relatedMemories: Array.from(allRelated),
        confidence: totalConfidence / memories.length,
      },
      relevanceScore: Math.max(...memories.map((m) => m.relevanceScore)),
    };
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

interface MemoryStats {
  total: number;
  byType: Record<string, number>;
  avgConfidence: number;
  avgRelevance: number;
  oldestTimestamp: number;
  newestTimestamp: number;
}

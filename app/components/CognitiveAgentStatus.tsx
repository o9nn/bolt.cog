/**
 * Cognitive Agent Network Status Component
 * Displays real-time status of the distributed agentic cognitive grammar system
 */

import { useStore } from '@nanostores/react';
import { memo, useEffect, useCallback } from 'react';
import { cognitiveAgentStore, cognitiveAgentActions, getCognitiveAgentSummary } from '~/lib/stores/cognitive-agents';

interface CognitiveAgentStatusProps {
  className?: string;
  compact?: boolean;
}

export const CognitiveAgentStatus = memo<CognitiveAgentStatusProps>(({ className = '', compact = false }) => {
  const state = useStore(cognitiveAgentStore);
  const summary = getCognitiveAgentSummary();

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/cognitive-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status' })
      });
      
      const result = await response.json() as { success: boolean; data?: any };
      if (result.success && result.data) {
        cognitiveAgentActions.updateFullState(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch cognitive agent status:', error);
      cognitiveAgentActions.updateNetworkStatus('error');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    
    // Poll for updates every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-400';
      case 'idle': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      case 'initializing': return 'text-blue-400';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return '🟢';
      case 'idle': return '🟡';  
      case 'error': return '🔴';
      case 'initializing': return '🔵';
      default: return '⚪';
    }
  };

  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="text-xs" title="Cognitive Agent Network">
          {getStatusIcon(state.networkStatus)}
        </span>
        <span className={`text-xs font-mono ${getStatusColor(state.networkStatus)}`}>
          {state.agents.length} agents
        </span>
        {summary.collaborationScore > 0 && (
          <span className="text-xs text-gray-400">
            {summary.collaborationScore}% collab
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`bg-gray-800 rounded-lg p-4 border border-gray-700 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          {getStatusIcon(state.networkStatus)}
          Cognitive Agent Network
        </h3>
        <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(state.networkStatus)} bg-gray-700`}>
          {state.networkStatus}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="text-center">
          <div className="text-xl font-bold text-white">{state.metrics.totalAgents}</div>
          <div className="text-xs text-gray-400">Total Agents</div>
        </div>
        <div className="text-center">
          <div className="text-xl font-bold text-green-400">{state.metrics.activeAgents}</div>
          <div className="text-xs text-gray-400">Active</div>
        </div>
        <div className="text-center">
          <div className="text-xl font-bold text-blue-400">{Math.round(state.metrics.collaborationScore * 100)}%</div>
          <div className="text-xs text-gray-400">Collaboration</div>
        </div>
        <div className="text-center">
          <div className="text-xl font-bold text-yellow-400">{state.metrics.messageQueue}</div>
          <div className="text-xs text-gray-400">Queue</div>
        </div>
      </div>

      {state.agents.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Agent Status</h4>
          {state.agents.map((agent) => (
            <div key={agent.id} className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  agent.status === 'idle' ? 'bg-green-400' :
                  agent.status === 'thinking' ? 'bg-yellow-400' :
                  agent.status === 'acting' ? 'bg-blue-400' :
                  agent.status === 'error' ? 'bg-red-400' : 'bg-gray-400'
                }`} />
                <span className="text-xs text-white font-mono">{agent.type}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{agent.capabilities} caps</span>
                <span className={`text-xs ${getStatusColor(agent.status)}`}>{agent.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {state.isEnhancingMessages && (
        <div className="mt-3 p-2 bg-blue-900/30 rounded border border-blue-700">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
            <span className="text-xs text-blue-300">Enhancing messages with cognitive grammar...</span>
          </div>
        </div>
      )}

      <div className="mt-3 text-xs text-gray-500">
        Last updated: {new Date(state.lastUpdate).toLocaleTimeString()}
      </div>
    </div>
  );
});

CognitiveAgentStatus.displayName = 'CognitiveAgentStatus';
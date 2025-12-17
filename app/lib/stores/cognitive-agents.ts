import { map } from 'nanostores';

export interface CognitiveAgentState {
  networkStatus: 'initializing' | 'active' | 'idle' | 'error';
  agents: Array<{
    id: string;
    type: string;
    status: string;
    capabilities: number;
  }>;
  metrics: {
    totalAgents: number;
    activeAgents: number;
    messageQueue: number;
    averageResponseTime: number;
    collaborationScore: number;
  };
  lastUpdate: number;
  isEnhancingMessages: boolean;
}

const initialState: CognitiveAgentState = {
  networkStatus: 'initializing',
  agents: [],
  metrics: {
    totalAgents: 0,
    activeAgents: 0,
    messageQueue: 0,
    averageResponseTime: 0,
    collaborationScore: 0
  },
  lastUpdate: 0,
  isEnhancingMessages: false
};

export const cognitiveAgentStore = map<CognitiveAgentState>(initialState);

// Actions to update the store
export const cognitiveAgentActions = {
  updateNetworkStatus: (status: CognitiveAgentState['networkStatus']) => {
    cognitiveAgentStore.setKey('networkStatus', status);
    cognitiveAgentStore.setKey('lastUpdate', Date.now());
  },

  updateAgents: (agents: CognitiveAgentState['agents']) => {
    cognitiveAgentStore.setKey('agents', agents);
    cognitiveAgentStore.setKey('lastUpdate', Date.now());
  },

  updateMetrics: (metrics: CognitiveAgentState['metrics']) => {
    cognitiveAgentStore.setKey('metrics', metrics);
    cognitiveAgentStore.setKey('lastUpdate', Date.now());
  },

  setEnhancingMessages: (enhancing: boolean) => {
    cognitiveAgentStore.setKey('isEnhancingMessages', enhancing);
  },

  updateFullState: (data: { status: string; metrics: any; agents: any[] }) => {
    cognitiveAgentStore.set({
      networkStatus: data.status as CognitiveAgentState['networkStatus'],
      agents: data.agents,
      metrics: data.metrics,
      lastUpdate: Date.now(),
      isEnhancingMessages: cognitiveAgentStore.get().isEnhancingMessages
    });
  },

  resetState: () => {
    cognitiveAgentStore.set(initialState);
  }
};

// Utility functions
export const getCognitiveAgentSummary = () => {
  const state = cognitiveAgentStore.get();
  return {
    isActive: state.networkStatus === 'active',
    agentCount: state.agents.length,
    collaborationScore: Math.round(state.metrics.collaborationScore * 100),
    status: state.networkStatus
  };
};
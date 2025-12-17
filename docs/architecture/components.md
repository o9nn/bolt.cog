# Component Architecture

This document details the component structure and relationships within the OpenBolt application, providing insight into how different parts of the system interact and depend on each other.

## Component Overview

OpenBolt follows a modular architecture with clear separation of concerns across different layers:

```mermaid
graph TB
    subgraph "Presentation Layer"
        Routes[Route Components]
        Components[UI Components]
        Hooks[React Hooks]
    end
    
    subgraph "Application Layer"
        Stores[State Stores]
        Runtime[Runtime Services]
        Persistence[Persistence Layer]
    end
    
    subgraph "Infrastructure Layer"
        WebContainer[WebContainer API]
        LLM[LLM Integration]
        Auth[Authentication]
    end
    
    subgraph "External Services"
        Anthropic[Anthropic API]
        CloudFlare[CloudFlare Services]
    end
    
    Routes --> Components
    Components --> Hooks
    Hooks --> Stores
    Stores --> Runtime
    Runtime --> Persistence
    Runtime --> WebContainer
    Runtime --> LLM
    LLM --> Anthropic
    Auth --> CloudFlare
    WebContainer --> CloudFlare
    
    style Routes fill:#e3f2fd
    style Stores fill:#f3e5f5
    style WebContainer fill:#e8f5e8
    style LLM fill:#fff3e0
```

## Directory Structure

```
app/
├── routes/                 # Route components and API endpoints
│   ├── _index.tsx         # Landing page
│   ├── chat.$id.tsx       # Chat interface
│   ├── api.chat.ts        # Chat API endpoint
│   ├── api.enhancer.ts    # Prompt enhancement API
│   └── api.cognitive-agents.ts # Cognitive agents API
├── components/            # Reusable UI components
├── lib/                   # Core application logic
│   ├── .server/          # Server-side only code
│   │   └── llm/          # LLM integration
│   ├── stores/           # State management
│   ├── hooks/            # React hooks
│   ├── runtime/          # Runtime services
│   ├── persistence/      # Data persistence
│   ├── webcontainer/     # WebContainer integration
│   └── cognitive/        # Cognitive agents
├── styles/               # Global styles
├── types/                # TypeScript type definitions
└── utils/                # Utility functions
```

## Core Component Modules

### 1. Route Components (`/routes`)

```mermaid
graph LR
    Index[/_index.tsx]
    Chat[/chat.$id.tsx]
    ChatAPI[/api.chat.ts]
    EnhancerAPI[/api.enhancer.ts]
    CognitiveAPI[/api.cognitive-agents.ts]
    
    Index --> Chat
    Chat --> ChatAPI
    Chat --> EnhancerAPI
    Chat --> CognitiveAPI
    
    style Index fill:#e1f5fe
    style Chat fill:#e1f5fe
    style ChatAPI fill:#fff3e0
    style EnhancerAPI fill:#fff3e0
    style CognitiveAPI fill:#fff3e0
```

**Key Responsibilities:**
- **_index.tsx**: Landing page and application entry point
- **chat.$id.tsx**: Main chat interface with AI interaction
- **api.chat.ts**: Handles chat messages and AI responses
- **api.enhancer.ts**: Prompt enhancement and optimization
- **api.cognitive-agents.ts**: Cognitive agent management

### 2. State Management (`/lib/stores`)

```mermaid
graph TB
    subgraph "State Stores"
        ThemeStore[theme.ts]
        EditorStore[editor.ts]
        FilesStore[files.ts]
        TerminalStore[terminal.ts]
        WorkbenchStore[workbench.ts]
        PreviewsStore[previews.ts]
        CognitiveStore[cognitive-agents.ts]
    end
    
    subgraph "Component Layer"
        ChatComponent[Chat Component]
        EditorComponent[Editor Component]
        TerminalComponent[Terminal Component]
        PreviewComponent[Preview Component]
    end
    
    ChatComponent --> WorkbenchStore
    ChatComponent --> CognitiveStore
    EditorComponent --> EditorStore
    EditorComponent --> FilesStore
    TerminalComponent --> TerminalStore
    PreviewComponent --> PreviewsStore
    
    style ThemeStore fill:#f3e5f5
    style EditorStore fill:#f3e5f5
    style FilesStore fill:#f3e5f5
    style WorkbenchStore fill:#f3e5f5
```

**Store Responsibilities:**
- **theme.ts**: Theme and UI preferences management
- **editor.ts**: Code editor state and configuration
- **files.ts**: File system state and operations
- **terminal.ts**: Terminal session and command history
- **workbench.ts**: Overall workbench state coordination
- **previews.ts**: Application preview management
- **cognitive-agents.ts**: AI agent state and interactions

### 3. Runtime Services (`/lib/runtime`)

```mermaid
graph LR
    MessageParser[message-parser.ts]
    ActionRunner[action-runner.ts]
    
    subgraph "External Integration"
        WebContainerAPI[WebContainer API]
        FileSystem[File System]
        Terminal[Terminal]
    end
    
    MessageParser --> ActionRunner
    ActionRunner --> WebContainerAPI
    ActionRunner --> FileSystem
    ActionRunner --> Terminal
    
    style MessageParser fill:#e8f5e8
    style ActionRunner fill:#e8f5e8
    style WebContainerAPI fill:#fff3e0
```

**Service Responsibilities:**
- **message-parser.ts**: Parses AI responses and extracts actions
- **action-runner.ts**: Executes parsed actions in the development environment

### 4. LLM Integration (`/lib/.server/llm`)

```mermaid
graph TB
    subgraph "LLM Components"
        Model[model.ts]
        ApiKey[api-key.ts]
        StreamText[stream-text.ts]
        SwitchableStream[switchable-stream.ts]
        Prompts[prompts.ts]
        Constants[constants.ts]
    end
    
    subgraph "External Services"
        AnthropicAPI[Anthropic Claude API]
    end
    
    Model --> ApiKey
    Model --> StreamText
    StreamText --> SwitchableStream
    StreamText --> AnthropicAPI
    Model --> Prompts
    Model --> Constants
    
    style Model fill:#fff3e0
    style StreamText fill:#fff3e0
    style AnthropicAPI fill:#ffebee
```

**LLM Component Responsibilities:**
- **model.ts**: AI model configuration and initialization
- **api-key.ts**: API key management and validation
- **stream-text.ts**: Streaming text responses from AI
- **switchable-stream.ts**: Stream switching and management
- **prompts.ts**: System prompts and prompt templates
- **constants.ts**: LLM-related constants and configuration

### 5. WebContainer Integration (`/lib/webcontainer`)

```mermaid
graph LR
    subgraph "WebContainer Components"
        API[WebContainer API]
        FileSystem[File System Manager]
        Terminal[Terminal Manager]
        Process[Process Manager]
    end
    
    subgraph "Browser Environment"
        NodeJS[Node.js Runtime]
        NPM[Package Manager]
        DevServer[Development Server]
    end
    
    API --> FileSystem
    API --> Terminal
    API --> Process
    FileSystem --> NodeJS
    Terminal --> NodeJS
    Process --> NPM
    Process --> DevServer
    
    style API fill:#e8f5e8
    style FileSystem fill:#e8f5e8
    style NodeJS fill:#f3e5f5
```

**WebContainer Responsibilities:**
- Browser-based Node.js runtime environment
- Virtual file system management
- Terminal and shell access
- Package installation and management
- Development server hosting

### 6. Persistence Layer (`/lib/persistence`)

```mermaid
graph TB
    subgraph "Persistence Components"
        DB[db.ts]
        ChatHistory[useChatHistory.ts]
        ChatDescription[ChatDescription.client.tsx]
        Index[index.ts]
    end
    
    subgraph "Storage"
        IndexedDB[Browser IndexedDB]
        LocalStorage[Local Storage]
    end
    
    DB --> IndexedDB
    ChatHistory --> DB
    ChatDescription --> ChatHistory
    Index --> DB
    Index --> LocalStorage
    
    style DB fill:#f3e5f5
    style ChatHistory fill:#f3e5f5
    style IndexedDB fill:#ffebee
```

**Persistence Responsibilities:**
- **db.ts**: Database abstraction and operations
- **useChatHistory.ts**: Chat history management hook
- **ChatDescription.client.tsx**: Chat metadata management
- **index.ts**: Persistence layer exports and utilities

## Component Interaction Patterns

### 1. User Interaction Flow

```mermaid
sequenceDiagram
    participant User
    participant ChatRoute as Chat Route
    participant WorkbenchStore as Workbench Store
    participant MessageParser as Message Parser
    participant ActionRunner as Action Runner
    participant WebContainer as WebContainer
    
    User->>ChatRoute: Input prompt
    ChatRoute->>WorkbenchStore: Update chat state
    WorkbenchStore->>MessageParser: Parse AI response
    MessageParser->>ActionRunner: Execute actions
    ActionRunner->>WebContainer: Modify environment
    WebContainer-->>ActionRunner: Return results
    ActionRunner-->>WorkbenchStore: Update state
    WorkbenchStore-->>ChatRoute: Refresh UI
    ChatRoute-->>User: Display results
```

### 2. File Operations Flow

```mermaid
sequenceDiagram
    participant AI as AI Service
    participant ActionRunner as Action Runner
    participant FilesStore as Files Store
    participant WebContainer as WebContainer
    participant EditorStore as Editor Store
    
    AI->>ActionRunner: File modification action
    ActionRunner->>FilesStore: Update file state
    FilesStore->>WebContainer: Write to filesystem
    WebContainer-->>FilesStore: Confirm write
    FilesStore->>EditorStore: Update editor content
    EditorStore-->>ActionRunner: Acknowledge update
```

### 3. Terminal Command Flow

```mermaid
sequenceDiagram
    participant User as User/AI
    participant TerminalStore as Terminal Store
    participant WebContainer as WebContainer
    participant Process as Process Manager
    
    User->>TerminalStore: Execute command
    TerminalStore->>WebContainer: Send command
    WebContainer->>Process: Run in shell
    Process-->>WebContainer: Stream output
    WebContainer-->>TerminalStore: Update terminal
    TerminalStore-->>User: Display output
```

## Component Dependencies

```mermaid
graph TD
    subgraph "High-Level Dependencies"
        Routes --> Stores
        Routes --> Hooks
        Stores --> Runtime
        Runtime --> WebContainer
        Runtime --> LLM
        Hooks --> Stores
    end
    
    subgraph "Cross-Cutting Concerns"
        Persistence --> Stores
        Authentication --> Routes
        Theme --> Components
    end
    
    style Routes fill:#e3f2fd
    style Stores fill:#f3e5f5
    style Runtime fill:#e8f5e8
    style WebContainer fill:#fff3e0
    style LLM fill:#ffebee
```

This component architecture ensures:
- **Clear separation of concerns** between presentation, application, and infrastructure layers
- **Unidirectional data flow** for predictable state management
- **Modular design** enabling easy testing and maintenance
- **Scalable structure** supporting future feature additions
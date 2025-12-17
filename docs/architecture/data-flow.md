# Data Flow Architecture

This document describes how data flows through the OpenBolt system, from user interactions to AI processing and back to the development environment.

## Overview

OpenBolt's data flow follows a reactive, event-driven architecture where user actions trigger cascading updates throughout the system. The flow is designed to be:

- **Unidirectional**: Data flows in predictable patterns
- **Reactive**: Changes propagate automatically through the system  
- **Streaming**: Real-time updates for AI responses and development feedback
- **Persistent**: Critical state is preserved across sessions

## High-Level Data Flow

```mermaid
graph TB
    subgraph "User Interface Layer"
        UserInput[User Input]
        ChatInterface[Chat Interface]
        Editor[Code Editor]
        Terminal[Terminal]
        Preview[Live Preview]
    end
    
    subgraph "Application State"
        WorkbenchStore[Workbench Store]
        FilesStore[Files Store]
        TerminalStore[Terminal Store]
        EditorStore[Editor Store]
    end
    
    subgraph "Processing Layer"
        MessageParser[Message Parser]
        ActionRunner[Action Runner]
        LLMService[LLM Service]
    end
    
    subgraph "Execution Environment"
        WebContainer[WebContainer]
        FileSystem[File System]
        NodeProcess[Node.js Process]
    end
    
    subgraph "External Services"
        AnthropicAPI[Anthropic Claude]
        CloudFlare[CloudFlare Workers]
    end
    
    UserInput --> ChatInterface
    ChatInterface --> WorkbenchStore
    WorkbenchStore --> LLMService
    LLMService --> AnthropicAPI
    AnthropicAPI --> LLMService
    LLMService --> MessageParser
    MessageParser --> ActionRunner
    ActionRunner --> FilesStore
    ActionRunner --> TerminalStore
    ActionRunner --> EditorStore
    ActionRunner --> WebContainer
    WebContainer --> FileSystem
    WebContainer --> NodeProcess
    
    FilesStore --> Editor
    TerminalStore --> Terminal
    NodeProcess --> Preview
    
    Editor --> EditorStore
    Terminal --> TerminalStore
    
    LLMService --> CloudFlare
    
    style UserInput fill:#e3f2fd
    style WorkbenchStore fill:#f3e5f5
    style MessageParser fill:#e8f5e8
    style WebContainer fill:#fff3e0
    style AnthropicAPI fill:#ffebee
```

## Detailed Data Flow Patterns

### 1. Chat Interaction Flow

```mermaid
sequenceDiagram
    participant User
    participant ChatUI as Chat UI Component
    participant WorkbenchStore as Workbench Store
    participant ChatAPI as Chat API Route
    participant LLMService as LLM Service
    participant AnthropicAPI as Anthropic API
    participant MessageParser as Message Parser
    participant ActionRunner as Action Runner
    
    User->>ChatUI: Enter prompt
    ChatUI->>WorkbenchStore: addMessage(userMessage)
    WorkbenchStore->>ChatAPI: POST /api/chat
    ChatAPI->>LLMService: processMessage()
    LLMService->>AnthropicAPI: stream completion
    
    loop Streaming Response
        AnthropicAPI-->>LLMService: partial response
        LLMService-->>ChatAPI: stream chunk
        ChatAPI-->>WorkbenchStore: updateMessage()
        WorkbenchStore-->>ChatUI: reactive update
        ChatUI-->>User: display partial response
    end
    
    LLMService->>MessageParser: parseActions()
    MessageParser->>ActionRunner: executeActions()
    ActionRunner-->>WorkbenchStore: updateExecutionState()
    WorkbenchStore-->>ChatUI: final update
```

### 2. File Operations Data Flow

```mermaid
sequenceDiagram
    participant AI as AI Response
    participant ActionRunner as Action Runner
    participant FilesStore as Files Store
    participant WebContainer as WebContainer
    participant FileSystem as File System
    participant EditorStore as Editor Store
    participant CodeEditor as Code Editor
    
    AI->>ActionRunner: writeFile(path, content)
    ActionRunner->>FilesStore: updateFile(path, content)
    FilesStore->>WebContainer: fs.writeFile()
    WebContainer->>FileSystem: write to virtual FS
    FileSystem-->>WebContainer: write complete
    WebContainer-->>FilesStore: success callback
    FilesStore->>EditorStore: syncEditorContent()
    EditorStore-->>CodeEditor: update editor
    FilesStore-->>ActionRunner: operation complete
    
    Note over FilesStore: File state persisted
    Note over EditorStore: Editor state synced
```

### 3. Terminal Command Execution Flow

```mermaid
sequenceDiagram
    participant User as User/AI
    participant TerminalUI as Terminal UI
    participant TerminalStore as Terminal Store
    participant WebContainer as WebContainer
    participant ShellProcess as Shell Process
    participant PreviewStore as Preview Store
    
    User->>TerminalUI: Execute command
    TerminalUI->>TerminalStore: addCommand(cmd)
    TerminalStore->>WebContainer: spawn(command)
    WebContainer->>ShellProcess: execute in shell
    
    loop Command Output
        ShellProcess-->>WebContainer: stdout/stderr
        WebContainer-->>TerminalStore: appendOutput()
        TerminalStore-->>TerminalUI: display output
    end
    
    ShellProcess-->>WebContainer: exit code
    WebContainer-->>TerminalStore: commandComplete()
    
    opt If dev server started
        WebContainer->>PreviewStore: updatePreviewURL()
        PreviewStore-->>TerminalUI: show preview link
    end
```

### 4. Code Editor Synchronization Flow

```mermaid
sequenceDiagram
    participant User
    participant CodeEditor as Code Editor
    participant EditorStore as Editor Store
    participant FilesStore as Files Store
    participant WebContainer as WebContainer
    
    User->>CodeEditor: Edit code
    CodeEditor->>EditorStore: updateContent()
    EditorStore->>FilesStore: markFileChanged()
    
    opt Auto-save enabled
        EditorStore->>FilesStore: saveFile()
        FilesStore->>WebContainer: fs.writeFile()
    end
    
    opt Manual save
        User->>CodeEditor: Ctrl+S
        CodeEditor->>EditorStore: saveFile()
        EditorStore->>FilesStore: saveFile()
        FilesStore->>WebContainer: fs.writeFile()
    end
    
    WebContainer-->>FilesStore: file saved
    FilesStore-->>EditorStore: update saved state
    EditorStore-->>CodeEditor: remove dirty indicator
```

## State Management Architecture

### Store Dependencies and Data Flow

```mermaid
graph TB
    subgraph "Core Stores"
        WorkbenchStore[Workbench Store]
        FilesStore[Files Store]
        EditorStore[Editor Store]
        TerminalStore[Terminal Store]
        PreviewsStore[Previews Store]
        ThemeStore[Theme Store]
        CognitiveStore[Cognitive Agents Store]
    end
    
    subgraph "External State"
        WebContainerState[WebContainer State]
        PersistentStorage[Persistent Storage]
        URLState[URL/Router State]
    end
    
    WorkbenchStore --> FilesStore
    WorkbenchStore --> TerminalStore
    WorkbenchStore --> PreviewsStore
    WorkbenchStore --> CognitiveStore
    
    FilesStore --> EditorStore
    FilesStore --> WebContainerState
    
    TerminalStore --> WebContainerState
    PreviewsStore --> WebContainerState
    
    FilesStore --> PersistentStorage
    WorkbenchStore --> PersistentStorage
    WorkbenchStore --> URLState
    
    ThemeStore --> PersistentStorage
    
    style WorkbenchStore fill:#f3e5f5
    style FilesStore fill:#e8f5e8
    style WebContainerState fill:#fff3e0
    style PersistentStorage fill:#ffebee
```

### Store Update Patterns

```mermaid
sequenceDiagram
    participant External as External Trigger
    participant Store as Nanostores Store
    participant Subscribers as React Components
    participant SideEffect as Side Effects
    
    External->>Store: update(newState)
    Store->>Store: validate & merge state
    
    par Notify Subscribers
        Store-->>Subscribers: state change event
        Subscribers-->>Subscribers: re-render
    and Execute Side Effects
        Store-->>SideEffect: trigger effects
        SideEffect-->>SideEffect: persist/sync/etc
    end
    
    Note over Store: State is immutable
    Note over Subscribers: Only changed components re-render
```

## Data Persistence Strategy

### Client-Side Storage

```mermaid
graph LR
    subgraph "Memory State"
        Stores[Nanostores]
        WebContainerFS[WebContainer FS]
    end
    
    subgraph "Browser Persistence"
        IndexedDB[IndexedDB]
        LocalStorage[Local Storage]
        SessionStorage[Session Storage]
    end
    
    subgraph "Remote Persistence"
        CloudFlareKV[CloudFlare KV]
        UserAuth[User Authentication]
    end
    
    Stores --> IndexedDB
    Stores --> LocalStorage
    WebContainerFS --> SessionStorage
    
    IndexedDB --> CloudFlareKV
    LocalStorage --> UserAuth
    
    style Stores fill:#f3e5f5
    style IndexedDB fill:#e8f5e8
    style CloudFlareKV fill:#fff3e0
```

### Persistence Timing

```mermaid
sequenceDiagram
    participant User
    participant Store as State Store
    participant Debouncer as Debounce Helper
    participant IndexedDB as IndexedDB
    participant CloudFlare as CloudFlare KV
    
    User->>Store: Multiple rapid changes
    Store->>Debouncer: schedule persist()
    
    loop Rapid Changes
        User->>Store: more changes
        Store->>Debouncer: reschedule persist()
    end
    
    Note over Debouncer: Wait for quiet period
    
    Debouncer->>IndexedDB: persist local
    IndexedDB-->>Debouncer: local save complete
    
    opt If authenticated
        Debouncer->>CloudFlare: sync remote
        CloudFlare-->>Debouncer: remote sync complete
    end
    
    Debouncer-->>Store: persistence complete
```

## Real-Time Data Streaming

### AI Response Streaming

```mermaid
sequenceDiagram
    participant Client as Client
    participant Worker as CloudFlare Worker
    participant LLM as LLM Service
    participant Anthropic as Anthropic API
    
    Client->>Worker: POST /api/chat (stream: true)
    Worker->>LLM: createStreamingResponse()
    LLM->>Anthropic: stream completion
    
    loop Streaming Tokens
        Anthropic-->>LLM: token chunk
        LLM-->>Worker: formatted chunk
        Worker-->>Client: Server-Sent Event
        Client-->>Client: append to UI
    end
    
    Anthropic-->>LLM: stream complete
    LLM-->>Worker: finalize response
    Worker-->>Client: close stream
    Client-->>Client: enable interactions
```

### WebContainer Event Streaming

```mermaid
sequenceDiagram
    participant UI as UI Component
    participant Store as Terminal Store
    participant WebContainer as WebContainer
    participant Process as Node Process
    
    UI->>Store: executeCommand()
    Store->>WebContainer: spawn command
    WebContainer->>Process: start process
    
    loop Process Running
        Process-->>WebContainer: stdout/stderr data
        WebContainer-->>Store: onData(chunk)
        Store-->>UI: update terminal display
    end
    
    Process-->>WebContainer: exit event
    WebContainer-->>Store: onExit(code)
    Store-->>UI: show completion
```

## Error Handling and Recovery

### Error Propagation Flow

```mermaid
graph TB
    subgraph "Error Sources"
        UserError[User Input Error]
        NetworkError[Network Error]
        AIError[AI Service Error]
        WebContainerError[WebContainer Error]
        SystemError[System Error]
    end
    
    subgraph "Error Handling"
        ErrorBoundary[Error Boundary]
        ErrorStore[Error Store]
        NotificationSystem[Notification System]
        RecoverySystem[Recovery System]
    end
    
    UserError --> ErrorBoundary
    NetworkError --> ErrorStore
    AIError --> ErrorStore
    WebContainerError --> ErrorStore
    SystemError --> ErrorBoundary
    
    ErrorBoundary --> NotificationSystem
    ErrorStore --> NotificationSystem
    ErrorStore --> RecoverySystem
    
    style UserError fill:#ffebee
    style ErrorStore fill:#fff3e0
    style RecoverySystem fill:#e8f5e8
```

This data flow architecture ensures:
- **Predictable state updates** through unidirectional flow
- **Real-time responsiveness** via streaming and reactive patterns
- **Robust error handling** with graceful degradation
- **Efficient persistence** with intelligent caching and syncing
- **Scalable architecture** supporting complex interactions
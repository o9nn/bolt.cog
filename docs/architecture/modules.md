# Module Dependencies

This document provides a detailed view of the module structure and dependency relationships within the OpenBolt codebase.

## Module Hierarchy Overview

```mermaid
graph TB
    subgraph "Application Entry Points"
        EntryClient[entry.client.tsx]
        EntryServer[entry.server.tsx]
        Root[root.tsx]
    end
    
    subgraph "Route Layer"
        IndexRoute[routes/_index.tsx]
        ChatRoute[routes/chat.$id.tsx]
        ChatAPI[routes/api.chat.ts]
        EnhancerAPI[routes/api.enhancer.ts]
        CognitiveAPI[routes/api.cognitive-agents.ts]
    end
    
    subgraph "Core Library"
        Stores[lib/stores/]
        Hooks[lib/hooks/]
        Runtime[lib/runtime/]
        Persistence[lib/persistence/]
        WebContainer[lib/webcontainer/]
        ServerLLM[lib/.server/llm/]
        Cognitive[lib/cognitive/]
    end
    
    subgraph "UI Components"
        Components[components/]
        Styles[styles/]
        Utils[utils/]
    end
    
    subgraph "Configuration"
        Types[types/]
        Config[Configuration Files]
    end
    
    EntryClient --> Root
    EntryServer --> Root
    Root --> IndexRoute
    Root --> ChatRoute
    
    ChatRoute --> ChatAPI
    ChatRoute --> EnhancerAPI
    ChatRoute --> CognitiveAPI
    
    ChatAPI --> ServerLLM
    EnhancerAPI --> ServerLLM
    CognitiveAPI --> Cognitive
    
    IndexRoute --> Components
    ChatRoute --> Components
    Components --> Hooks
    Hooks --> Stores
    
    Stores --> Runtime
    Runtime --> WebContainer
    Runtime --> Persistence
    
    Components --> Styles
    Components --> Utils
    
    Stores --> Types
    Runtime --> Types
    
    style EntryClient fill:#e3f2fd
    style ServerLLM fill:#ffebee
    style Stores fill:#f3e5f5
    style WebContainer fill:#e8f5e8
```

## Detailed Module Structure

### 1. Routes Module Dependencies

```mermaid
graph LR
    subgraph "Route Files"
        Index[_index.tsx]
        Chat[chat.$id.tsx]
        ChatAPIRoute[api.chat.ts]
        EnhancerAPIRoute[api.enhancer.ts]
        CognitiveAPIRoute[api.cognitive-agents.ts]
    end
    
    subgraph "Remix Framework"
        RemixReact[@remix-run/react]
        RemixCloudflare[@remix-run/cloudflare]
        LoaderFunction[Loader Functions]
        ActionFunction[Action Functions]
    end
    
    subgraph "External Dependencies"
        React[react]
        ReactDOM[react-dom]
        FramerMotion[framer-motion]
    end
    
    Index --> RemixReact
    Chat --> RemixReact
    ChatAPIRoute --> RemixCloudflare
    EnhancerAPIRoute --> RemixCloudflare
    CognitiveAPIRoute --> RemixCloudflare
    
    RemixReact --> React
    RemixCloudflare --> LoaderFunction
    RemixCloudflare --> ActionFunction
    
    Chat --> FramerMotion
    Index --> ReactDOM
    
    style Index fill:#000000,color:#ffffff
    style Chat fill:#000000,color:#ffffff
    style RemixReact fill:#000000,color:#ffffff
```

### 2. Stores Module Dependencies

```mermaid
graph TB
    subgraph "Store Files"
        WorkbenchStore[workbench.ts]
        FilesStore[files.ts]
        EditorStore[editor.ts]
        TerminalStore[terminal.ts]
        PreviewsStore[previews.ts]
        ThemeStore[theme.ts]
        CognitiveStore[cognitive-agents.ts]
    end
    
    subgraph "State Management"
        Nanostores[nanostores]
        NanostoresReact[@nanostores/react]
    end
    
    subgraph "Type Definitions"
        StoreTypes[Store Types]
        WebContainerTypes[WebContainer Types]
        ChatTypes[Chat Types]
    end
    
    subgraph "Utilities"
        DateFns[date-fns]
        Diff[diff]
        IstextorBinary[istextorbinary]
    end
    
    WorkbenchStore --> Nanostores
    FilesStore --> Nanostores
    EditorStore --> Nanostores
    TerminalStore --> Nanostores
    PreviewsStore --> Nanostores
    ThemeStore --> Nanostores
    CognitiveStore --> Nanostores
    
    Nanostores --> NanostoresReact
    
    WorkbenchStore --> StoreTypes
    FilesStore --> WebContainerTypes
    CognitiveStore --> ChatTypes
    
    WorkbenchStore --> DateFns
    FilesStore --> Diff
    FilesStore --> IstextorBinary
    
    style WorkbenchStore fill:#f3e5f5
    style Nanostores fill:#fff3e0
    style StoreTypes fill:#e8f5e8
```

### 3. Runtime Module Dependencies

```mermaid
graph TB
    subgraph "Runtime Files"
        MessageParser[message-parser.ts]
        ActionRunner[action-runner.ts]
        MessageParserSpec[message-parser.spec.ts]
    end
    
    subgraph "Processing Libraries"
        UnifiedJS[unified]
        UnistUtilVisit[unist-util-visit]
        RemarkGFM[remark-gfm]
        RehypeRaw[rehype-raw]
        RehypeSanitize[rehype-sanitize]
    end
    
    subgraph "WebContainer Integration"
        WebContainerAPI[@webcontainer/api]
        FileSystemAPI[File System API]
        ProcessAPI[Process API]
    end
    
    subgraph "Type System"
        RuntimeTypes[Runtime Types]
        ActionTypes[Action Types]
        ParserTypes[Parser Types]
    end
    
    MessageParser --> UnifiedJS
    MessageParser --> UnistUtilVisit
    MessageParser --> RemarkGFM
    MessageParser --> RehypeRaw
    MessageParser --> RehypeSanitize
    
    ActionRunner --> WebContainerAPI
    ActionRunner --> FileSystemAPI
    ActionRunner --> ProcessAPI
    
    MessageParser --> RuntimeTypes
    ActionRunner --> ActionTypes
    MessageParserSpec --> ParserTypes
    
    style MessageParser fill:#e8f5e8
    style ActionRunner fill:#e8f5e8
    style WebContainerAPI fill:#fff3e0
```

### 4. LLM Module Dependencies

```mermaid
graph TB
    subgraph "LLM Server Files"
        Model[model.ts]
        ApiKey[api-key.ts]
        StreamText[stream-text.ts]
        SwitchableStream[switchable-stream.ts]
        Prompts[prompts.ts]
        Constants[constants.ts]
    end
    
    subgraph "AI SDK"
        AISDKAnthropic[@ai-sdk/anthropic]
        AISDK[ai]
        AISDKCore[AI SDK Core]
    end
    
    subgraph "Streaming & HTTP"
        ReadableStream[ReadableStream API]
        Response[Response API]
        Headers[Headers API]
    end
    
    subgraph "Configuration"
        EnvVariables[Environment Variables]
        TypeDefinitions[Type Definitions]
        ErrorHandling[Error Handling]
    end
    
    Model --> AISDKAnthropic
    Model --> AISDK
    StreamText --> AISDKCore
    SwitchableStream --> ReadableStream
    
    StreamText --> Response
    StreamText --> Headers
    
    ApiKey --> EnvVariables
    Model --> TypeDefinitions
    StreamText --> ErrorHandling
    Constants --> EnvVariables
    
    style Model fill:#ffebee
    style StreamText fill:#ffebee
    style AISDKAnthropic fill:#fff3e0
```

### 5. UI Components Module Dependencies

```mermaid
graph LR
    subgraph "UI Components"
        ChatComponent[Chat Component]
        EditorComponent[Editor Component]
        TerminalComponent[Terminal Component]
        PreviewComponent[Preview Component]
        SettingsComponent[Settings Component]
    end
    
    subgraph "React Ecosystem"
        React[react]
        ReactDOM[react-dom]
        ReactHooks[React Hooks]
        ReactHotkeysHook[react-hotkeys-hook]
    end
    
    subgraph "UI Libraries"
        RadixUI[@radix-ui/*]
        FramerMotion[framer-motion]
        ReactToastify[react-toastify]
        ReactResizablePanels[react-resizable-panels]
    end
    
    subgraph "Code Editor"
        CodeMirror[@codemirror/*]
        CodeMirrorTheme[@uiw/codemirror-theme-vscode]
        LezerHighlight[@lezer/highlight]
    end
    
    subgraph "Markdown & Syntax"
        ReactMarkdown[react-markdown]
        Shiki[shiki]
        RehypePlugins[Rehype Plugins]
    end
    
    ChatComponent --> React
    EditorComponent --> React
    TerminalComponent --> React
    PreviewComponent --> React
    SettingsComponent --> React
    
    React --> ReactHooks
    ChatComponent --> ReactHotkeysHook
    
    SettingsComponent --> RadixUI
    ChatComponent --> FramerMotion
    ChatComponent --> ReactToastify
    EditorComponent --> ReactResizablePanels
    
    EditorComponent --> CodeMirror
    EditorComponent --> CodeMirrorTheme
    EditorComponent --> LezerHighlight
    
    ChatComponent --> ReactMarkdown
    EditorComponent --> Shiki
    ReactMarkdown --> RehypePlugins
    
    style ChatComponent fill:#e3f2fd
    style CodeMirror fill:#fff3e0
    style ReactMarkdown fill:#e8f5e8
```

### 6. WebContainer Module Dependencies

```mermaid
graph TB
    subgraph "WebContainer Integration"
        WebContainerStore[WebContainer Store]
        FileSystemManager[File System Manager]
        TerminalManager[Terminal Manager]
        ProcessManager[Process Manager]
    end
    
    subgraph "WebContainer API"
        WebContainerAPI[@webcontainer/api]
        FileSystemAPI[FileSystem API]
        ProcessAPI[Process API]
        TerminalAPI[Terminal API]
    end
    
    subgraph "Terminal UI"
        XTerm[@xterm/xterm]
        XTermAddonFit[@xterm/addon-fit]
        XTermAddonWebLinks[@xterm/addon-web-links]
    end
    
    subgraph "File Operations"
        NodePath[node:path]
        NodeBuffer[node:buffer]
        TextEncoder[TextEncoder/TextDecoder]
    end
    
    WebContainerStore --> WebContainerAPI
    FileSystemManager --> FileSystemAPI
    TerminalManager --> TerminalAPI
    ProcessManager --> ProcessAPI
    
    TerminalManager --> XTerm
    TerminalManager --> XTermAddonFit
    TerminalManager --> XTermAddonWebLinks
    
    FileSystemManager --> NodePath
    FileSystemManager --> NodeBuffer
    FileSystemManager --> TextEncoder
    
    style WebContainerStore fill:#e8f5e8
    style WebContainerAPI fill:#fff3e0
    style XTerm fill:#f3e5f5
```

## Cross-Module Dependencies

### Import/Export Relationships

```mermaid
graph TB
    subgraph "Public API Exports"
        StoreExports[Store Exports]
        HookExports[Hook Exports]
        ComponentExports[Component Exports]
        UtilExports[Utility Exports]
    end
    
    subgraph "Internal Dependencies"
        StoreToStore[Store → Store]
        HookToStore[Hook → Store]
        ComponentToHook[Component → Hook]
        RuntimeToWebContainer[Runtime → WebContainer]
    end
    
    subgraph "External Package Dependencies"
        NPMPackages[NPM Packages]
        TypeDefinitions[Type Definitions]
        BuildTools[Build Tools]
    end
    
    StoreExports --> StoreToStore
    HookExports --> HookToStore
    ComponentExports --> ComponentToHook
    UtilExports --> RuntimeToWebContainer
    
    StoreToStore --> NPMPackages
    HookToStore --> TypeDefinitions
    ComponentToHook --> BuildTools
    
    style StoreExports fill:#f3e5f5
    style NPMPackages fill:#fff3e0
    style TypeDefinitions fill:#e8f5e8
```

### Dependency Injection Patterns

```mermaid
sequenceDiagram
    participant App as Application
    participant DI as Dependency Injection
    participant Store as Store Layer
    participant Runtime as Runtime Layer
    participant WebContainer as WebContainer
    
    App->>DI: Initialize dependencies
    DI->>Store: Create store instances
    DI->>Runtime: Initialize runtime services
    DI->>WebContainer: Setup WebContainer API
    
    Store->>Runtime: Inject runtime dependencies
    Runtime->>WebContainer: Inject WebContainer instance
    
    App->>Store: Subscribe to store updates
    Store-->>App: Notify state changes
```

## Package.json Dependencies Analysis

### Production Dependencies

```mermaid
pie title Production Dependencies by Category
    "React Ecosystem" : 25
    "UI Libraries" : 20
    "AI/LLM Integration" : 15
    "WebContainer API" : 10
    "Code Editor" : 10
    "Markdown/Syntax" : 10
    "Utilities" : 10
```

### Development Dependencies

```mermaid
pie title Development Dependencies by Category
    "Build Tools" : 30
    "TypeScript" : 25
    "Linting/Formatting" : 20
    "Testing" : 15
    "CloudFlare Tools" : 10
```

## Bundle Analysis

### Code Splitting Strategy

```mermaid
graph TB
    subgraph "Main Bundle"
        MainChunk[main.js]
        VendorChunk[vendor.js]
        RuntimeChunk[runtime.js]
    end
    
    subgraph "Route Chunks"
        IndexChunk[index.js]
        ChatChunk[chat.js]
        APIChunk[api.js]
    end
    
    subgraph "Feature Chunks"
        EditorChunk[editor.js]
        TerminalChunk[terminal.js]
        WebContainerChunk[webcontainer.js]
        LLMChunk[llm.js]
    end
    
    subgraph "Lazy Loaded"
        SettingsChunk[settings.js]
        HelpChunk[help.js]
        ThemeChunk[theme.js]
    end
    
    MainChunk --> VendorChunk
    MainChunk --> RuntimeChunk
    
    MainChunk --> IndexChunk
    MainChunk --> ChatChunk
    MainChunk --> APIChunk
    
    ChatChunk --> EditorChunk
    ChatChunk --> TerminalChunk
    ChatChunk --> WebContainerChunk
    ChatChunk --> LLMChunk
    
    IndexChunk --> SettingsChunk
    ChatChunk --> HelpChunk
    IndexChunk --> ThemeChunk
    
    style MainChunk fill:#646cff
    style VendorChunk fill:#fff3e0
    style EditorChunk fill:#e8f5e8
    style SettingsChunk fill:#f3e5f5
```

### Module Size Analysis

```mermaid
xychart-beta
    title "Module Bundle Sizes (KB)"
    x-axis [Vendor, Main, Chat, Editor, Terminal, WebContainer, LLM, Settings]
    y-axis "Size (KB)" 0 --> 500
    bar [450, 120, 80, 60, 40, 35, 25, 15]
```

## Dependency Management Best Practices

### Version Management

```mermaid
graph LR
    subgraph "Version Control"
        PNPMLock[pnpm-lock.yaml]
        PackageJSON[package.json]
        Resolutions[Resolutions]
    end
    
    subgraph "Update Strategy"
        SemverRanges[Semver Ranges]
        SecurityUpdates[Security Updates]
        BreakingChanges[Breaking Changes]
    end
    
    subgraph "Validation"
        TypeChecking[Type Checking]
        LintChecks[Lint Checks]
        TestSuite[Test Suite]
    end
    
    PackageJSON --> PNPMLock
    PackageJSON --> Resolutions
    
    SemverRanges --> SecurityUpdates
    SecurityUpdates --> BreakingChanges
    
    BreakingChanges --> TypeChecking
    TypeChecking --> LintChecks
    LintChecks --> TestSuite
    
    style PNPMLock fill:#f3e5f5
    style SecurityUpdates fill:#ffebee
    style TypeChecking fill:#e8f5e8
```

### Circular Dependency Prevention

```mermaid
graph TB
    subgraph "Dependency Rules"
        NoCircular[No Circular Dependencies]
        LayeredArchitecture[Layered Architecture]
        InterfaceSegregation[Interface Segregation]
    end
    
    subgraph "Detection Tools"
        ESLintRules[ESLint Rules]
        TypeScriptStrict[TypeScript Strict Mode]
        BundleAnalyzer[Bundle Analyzer]
    end
    
    subgraph "Prevention Strategies"
        DependencyInjection[Dependency Injection]
        EventBus[Event Bus Pattern]
        StateManagement[Centralized State]
    end
    
    NoCircular --> ESLintRules
    LayeredArchitecture --> TypeScriptStrict
    InterfaceSegregation --> BundleAnalyzer
    
    ESLintRules --> DependencyInjection
    TypeScriptStrict --> EventBus
    BundleAnalyzer --> StateManagement
    
    style NoCircular fill:#e8f5e8
    style ESLintRules fill:#fff3e0
    style DependencyInjection fill:#f3e5f5
```

This module dependency architecture ensures:
- **Clear separation of concerns** across modules
- **Minimal coupling** between components
- **Efficient bundle splitting** for optimal loading
- **Type safety** throughout the dependency chain
- **Maintainable structure** for long-term development
# OpenBolt Architecture Overview

OpenBolt is an AI-powered full-stack web development platform that enables users to prompt, run, edit, and deploy applications directly in the browser. This document provides a comprehensive overview of the system architecture.

## System Overview

OpenBolt combines cutting-edge AI models with a browser-based development environment powered by StackBlitz's WebContainers API, creating a unique development experience where AI has complete control over the entire development lifecycle.

```mermaid
graph TB
    subgraph "Browser Environment"
        UI[React/Remix UI]
        WC[WebContainer API]
        Terminal[Terminal Interface]
        Editor[Code Editor]
        Preview[Live Preview]
    end
    
    subgraph "Server Infrastructure"
        CF[CloudFlare Workers]
        LLM[AI/LLM Service]
        AUTH[Authentication]
    end
    
    subgraph "External Services"
        ANTHROPIC[Anthropic Claude API]
        CDN[CloudFlare CDN]
    end
    
    User --> UI
    UI --> CF
    CF --> LLM
    LLM --> ANTHROPIC
    UI --> WC
    WC --> Terminal
    WC --> Editor
    WC --> Preview
    CF --> CDN
    CF --> AUTH
    
    style UI fill:#e1f5fe
    style WC fill:#f3e5f5
    style CF fill:#fff3e0
    style LLM fill:#e8f5e8
```

## Core Design Principles

### 1. **Browser-First Development**
- Complete development environment runs in the browser
- No local setup or installations required
- Real-time collaboration and sharing capabilities

### 2. **AI-Driven Development**
- AI has full control over filesystem, terminal, and package manager
- Intelligent code generation and modification
- Context-aware assistance throughout the development lifecycle

### 3. **Full-Stack Capability**
- Support for Node.js servers and backend development
- Integration with third-party APIs
- Complete application deployment from chat interface

### 4. **Serverless Architecture**
- CloudFlare Workers for scalable server-side logic
- Edge-based deployment for global performance
- Stateless design for reliability and scalability

## Technology Stack

```mermaid
graph LR
    subgraph "Frontend Stack"
        React[React 18]
        Remix[Remix Framework]
        TypeScript[TypeScript]
        UnoCSS[UnoCSS Styling]
        CodeMirror[CodeMirror Editor]
    end
    
    subgraph "Backend Stack"
        Workers[CloudFlare Workers]
        Pages[CloudFlare Pages]
        API[AI SDK]
        WebContainer[WebContainer API]
    end
    
    subgraph "Build & Dev Tools"
        Vite[Vite Bundler]
        PNPM[PNPM Package Manager]
        ESLint[ESLint Linting]
        Prettier[Prettier Formatting]
    end
    
    React --> Remix
    Remix --> TypeScript
    TypeScript --> UnoCSS
    Remix --> CodeMirror
    
    Workers --> Pages
    Workers --> API
    API --> WebContainer
    
    Vite --> PNPM
    PNPM --> ESLint
    ESLint --> Prettier
    
    style React fill:#61dafb
    style Remix fill:#000000,color:#ffffff
    style TypeScript fill:#3178c6,color:#ffffff
    style Workers fill:#f38020
```

## Key Components

### Frontend Layer
- **React/Remix Application**: Main user interface and application framework
- **Code Editor**: Advanced code editing with syntax highlighting and autocompletion
- **Terminal Interface**: Browser-based terminal for development operations
- **Live Preview**: Real-time preview of running applications
- **Chat Interface**: AI interaction and prompt handling

### Development Environment
- **WebContainer API**: Browser-based Node.js runtime environment
- **File System**: Virtual file system for project management
- **Package Manager**: NPM/PNPM integration for dependency management
- **Development Server**: Hot-reload enabled development server

### AI Integration Layer
- **LLM Service**: Integration with Anthropic Claude AI models
- **Prompt Processing**: Natural language to code conversion
- **Context Management**: Maintains conversation and project context
- **Action Runner**: Executes AI-generated development actions

### Infrastructure Layer
- **CloudFlare Workers**: Serverless compute for backend logic
- **CloudFlare Pages**: Static site hosting and deployment
- **Edge CDN**: Global content delivery network
- **Authentication**: User authentication and session management

## Data Flow Architecture

The system follows a clear data flow pattern from user interaction to AI processing and back to the development environment:

```mermaid
sequenceDiagram
    participant User
    participant UI as React UI
    participant CF as CloudFlare Worker
    participant AI as LLM Service
    participant WC as WebContainer
    participant FS as File System
    
    User->>UI: Enter prompt/command
    UI->>CF: Send request with context
    CF->>AI: Process with Claude API
    AI-->>CF: Return actions/code
    CF-->>UI: Stream response
    UI->>WC: Execute actions
    WC->>FS: Modify files
    WC->>WC: Run build/dev server
    WC-->>UI: Update preview
    UI-->>User: Show results
```

## Security Model

- **Sandboxed Execution**: All code runs in isolated WebContainer environments
- **No Server Access**: Generated code cannot access production servers
- **Client-Side Security**: Sensitive operations handled client-side
- **API Key Management**: Secure handling of external API credentials

## Performance Characteristics

- **Edge Computing**: CloudFlare's global edge network for low latency
- **Client-Side Processing**: Reduces server load and improves responsiveness
- **Streaming Responses**: Real-time AI response streaming
- **Efficient Bundling**: Vite-based fast build and hot reload

## Deployment Model

```mermaid
graph TD
    subgraph "Development"
        DevEnv[Local Development]
        DevBuild[Vite Dev Server]
    end
    
    subgraph "Build Process"
        Build[Production Build]
        Optimize[Asset Optimization]
        Bundle[Bundle Generation]
    end
    
    subgraph "CloudFlare Infrastructure"
        Workers[CloudFlare Workers]
        Pages[CloudFlare Pages]
        CDN[Global CDN]
        DNS[CloudFlare DNS]
    end
    
    DevEnv --> DevBuild
    DevEnv --> Build
    Build --> Optimize
    Optimize --> Bundle
    Bundle --> Workers
    Bundle --> Pages
    Workers --> CDN
    Pages --> CDN
    CDN --> DNS
    
    style Workers fill:#f38020
    style Pages fill:#f38020
    style CDN fill:#f38020
```

This architecture enables OpenBolt to provide a powerful, scalable, and secure development environment that brings AI-assisted development directly to the browser while maintaining production-grade performance and reliability.